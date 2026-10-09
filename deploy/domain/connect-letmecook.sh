#!/usr/bin/env bash
# Switch only LetMeCook's own nginx site. Never open a tunnel token or restart a connector.
set +x
set -euo pipefail
umask 077

artifact_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
site=/etc/nginx/sites-available/letmecook.conf
enabled_site=/etc/nginx/sites-enabled/letmecook.conf
protected_units=(cloudflared-bloom.service cloudflared-smartaqua.service cloudflared-wego.service cloudflared.service cloudflared-letmecook.service)
before_pids=()
backup_dir=''
temp_site=''
site_changed=false
committed=false
original_site_mode=''
original_site_uid=''
original_site_gid=''

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\n' 'Usage: sudo bash connect-letmecook.sh' 'No token, password, or repository credentials are accepted by this script.'; }

[[ $# -eq 0 ]] || { usage; exit 1; }
[[ $EUID -eq 0 ]] || fail 'Run this prepared script using sudo in your own terminal.'
for command in nginx systemctl python3 install cp mv readlink date mktemp chmod rm flock stat; do
    command -v "$command" >/dev/null || fail "Missing required command: $command"
done
lock_file=/run/lock/letmecook-origin.lock
[[ ! -L "$lock_file" ]] || fail 'The dedicated installer lock must not be a symlink.'
if [[ -e "$lock_file" ]]; then
    [[ -f "$lock_file" && "$(stat -c '%u:%a' -- "$lock_file")" == 0:600 ]] || fail 'The existing installer lock must be a private root-owned regular file.'
else
    (set -o noclobber; : > "$lock_file") 2>/dev/null || fail 'Could not create the dedicated installer lock.'
fi
exec 9>"$lock_file"
flock -n 9 || fail 'Another LetMeCook origin activation is already running.'
[[ -f "$artifact_dir/nginx-letmecook.conf" && ! -L "$artifact_dir/nginx-letmecook.conf" ]] || fail 'Keep the reviewed nginx configuration beside this script.'
[[ -f "$artifact_dir/verify-public-origin.py" && ! -L "$artifact_dir/verify-public-origin.py" ]] || fail 'Keep the origin verifier beside this script.'
[[ -f "$site" && ! -L "$site" ]] || fail 'Expected existing regular LetMeCook site at /etc/nginx/sites-available/letmecook.conf.'
[[ -L "$enabled_site" && "$(readlink -f -- "$enabled_site")" == "$site" ]] || fail 'The enabled LetMeCook site must point to its own sites-available configuration.'
systemctl is-active --quiet nginx.service || fail 'Host nginx must already be active.'
systemctl is-enabled --quiet nginx.service || fail 'Host nginx must already start at boot.'
systemctl is-enabled --quiet cloudflared-letmecook.service || fail 'The existing LetMeCook connector must already start at boot.'
[[ "$(systemctl show --value --property=Restart cloudflared-letmecook.service)" == always ]] || fail 'The existing connector must already use Restart=always.'
for unit in "${protected_units[@]}"; do
    systemctl is-active --quiet "$unit" || fail "Required existing connector is inactive: $unit"
    pid="$(systemctl show --value --property=MainPID "$unit")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || fail "No active connector PID: $unit"
    before_pids+=("$pid")
done

check_connectors() {
    local index unit current_pid
    for index in "${!protected_units[@]}"; do
        unit="${protected_units[$index]}"
        systemctl is-active --quiet "$unit" || { printf 'Existing connector became inactive: %s\n' "$unit" >&2; return 1; }
        current_pid="$(systemctl show --value --property=MainPID "$unit")" || return 1
        [[ "$current_pid" == "${before_pids[$index]}" ]] || { printf 'Existing connector PID changed: %s\n' "$unit" >&2; return 1; }
    done
}

rollback() {
    local origin_restored=true
    printf '%s\n' 'Restoring only the previous LetMeCook origin.' >&2
    if "$site_changed"; then
        install -m "$original_site_mode" -o "$original_site_uid" -g "$original_site_gid" -- "$backup_dir/nginx-letmecook.conf.before" "$site" || origin_restored=false
        if "$origin_restored"; then
            nginx -t && systemctl reload nginx.service || origin_restored=false
        fi
    fi
    check_connectors || return 1
    "$origin_restored"
}

on_exit() {
    local status=$?
    trap - EXIT
    if ! "$committed" && "$site_changed"; then
        if rollback; then
            printf 'Activation failed; previous LetMeCook origin restored. Backup: %s\n' "$backup_dir" >&2
        else
            printf 'Activation failed; rollback needs attention. Backup: %s\n' "$backup_dir" >&2
        fi
        status=1
    fi
    [[ -z "$temp_site" ]] || rm -f -- "$temp_site"
    exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# This checks the newly built full app before changing the public origin.
# Existing catalog visibility and provenance are preserved as requested by the owner.
python3 "$artifact_dir/verify-public-origin.py" http://127.0.0.1:9401 --expect-demo any --check-auth
nginx -t

release="$(date -u +%Y%m%dT%H%M%SZ)-$$"
backup_dir="/var/backups/letmecook-origin/$release"
[[ ! -e /var/backups/letmecook-origin || ! -L /var/backups/letmecook-origin ]] || fail 'The dedicated backup directory must not be a symlink.'
install -d -m 0700 -o root -g root /var/backups/letmecook-origin "$backup_dir"
cp -p -- "$site" "$backup_dir/nginx-letmecook.conf.before"
original_site_mode="$(stat -c '%a' -- "$site")"
original_site_uid="$(stat -c '%u' -- "$site")"
original_site_gid="$(stat -c '%g' -- "$site")"
chmod 0600 "$backup_dir/nginx-letmecook.conf.before"
printf '%s\n' "$(readlink -- "$enabled_site")" > "$backup_dir/sites-enabled-target.before.txt"

temp_site="$(mktemp /etc/nginx/sites-available/letmecook.conf.new.XXXXXXXX)"
install -m 0644 -o root -g root "$artifact_dir/nginx-letmecook.conf" "$temp_site"
site_changed=true
mv -fT -- "$temp_site" "$site"
temp_site=''
nginx -t
systemctl reload nginx.service

printf '%s\n' 'Waiting for the new nginx workers to serve the full application (up to 30 seconds).'
python3 "$artifact_dir/verify-public-origin.py" http://127.0.0.1:8092 --expect-demo any --check-auth --check-www --wait-seconds 30
python3 "$artifact_dir/verify-public-origin.py" https://letmecook.ca --expect-demo any --check-auth --check-www --wait-seconds 30
check_connectors
committed=true
printf '%s\n' 'Connected https://letmecook.ca to the existing full LetMeCook application.' 'www redirects to the main domain. All five connector PIDs remain unchanged.' 'No token was read, no connector restarted, no reboot performed.'
printf 'Previous own-site configuration: %s\n' "$backup_dir"
printf '%s\n' 'The existing catalog, source attribution and permission metadata are preserved. No database rows were changed.'
