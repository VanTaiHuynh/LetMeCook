#!/usr/bin/env python3
"""Provision local runtime roles without logging passwords or replacing Supabase credentials."""
import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import subprocess


def read_environment(path):
    return {line.split('=', 1)[0]: line.split('=', 1)[1]
            for line in path.read_text().splitlines() if '=' in line and not line.startswith('#')} if path.exists() else {}


def scram_verifier(password):
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.digest(salted, b'Client Key', 'sha256')).digest()
    server = hmac.digest(salted, b'Server Key', 'sha256')
    encode = lambda value: base64.b64encode(value).decode()
    return 'SCRAM-SHA-256$4096:' + encode(salt) + '$' + encode(stored) + ':' + encode(server)


def main():
    os.umask(0o077)
    deploy = Path(__file__).resolve().parent
    role_path = deploy / '.env.roles'
    local_path = deploy / '.env.local'
    local_values = read_environment(local_path)
    admin_password = local_values.get('SUPABASE_PASSWORD')
    if not admin_password:
        raise RuntimeError('Generate the protected local Supabase environment before provisioning roles.')
    values = read_environment(role_path)
    for key in ['GATEWAY_DATABASE_PASSWORD', 'WORKER_DATABASE_PASSWORD']:
        values.setdefault(key, secrets.token_urlsafe(36))
        if not values[key] or any(char in values[key] for char in "\n\r'$"):
            raise RuntimeError('Invalid protected runtime-role password configuration.')
    # Save before provisioning: retry uses the same passwords after an unknown outcome.
    role_path.write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
    role_path.chmod(0o600)
    migration = (deploy / 'migrations/20261008_runtime_roles.sql').read_text()
    for role, key in [('letmecook_gateway', 'GATEWAY_DATABASE_PASSWORD'), ('letmecook_worker', 'WORKER_DATABASE_PASSWORD')]:
        migration += "\nALTER ROLE " + role + " LOGIN PASSWORD '" + scram_verifier(values[key]) + "';\n"
    completed = subprocess.run(['docker', 'exec', '-e', 'PGPASSWORD', '-i', 'supabase_db_letmecook', 'psql', '-X', '-v',
                                'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
                               input=migration, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env={**os.environ, 'PGPASSWORD': admin_password})
    if completed.returncode:
        raise RuntimeError('Local runtime-role provisioning failed; configuration has been retained for retry.')
    local_values.update(values)
    local_path.write_text(''.join(key + '=' + value + '\n' for key, value in local_values.items()))
    local_path.chmod(0o600)
    print('Local runtime roles provisioned; credentials remain in protected environment files.')


if __name__ == '__main__':
    main()
