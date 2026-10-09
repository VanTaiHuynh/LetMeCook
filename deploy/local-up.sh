#!/usr/bin/env bash
set -euo pipefail
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for required in docker supabase python3 curl; do
  command -v "$required" >/dev/null || { echo "Missing: $required" >&2; exit 1; }
done
bash "$deploy_dir/local-ai-setup.sh"
docker network inspect letmecook-local >/dev/null 2>&1 ||
  docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 letmecook-local >/dev/null
supabase start --workdir "$deploy_dir" --network-id letmecook-local >"$deploy_dir/supabase-start.log" 2>&1
chmod 600 "$deploy_dir/supabase-start.log"
docker exec -i supabase_db_letmecook psql -v ON_ERROR_STOP=1 -U postgres -d postgres <"$deploy_dir/schema.sql"
docker exec -i supabase_db_letmecook psql -v ON_ERROR_STOP=1 -U postgres -d postgres <"$deploy_dir/seed.sql"
if [[ -s "$deploy_dir/data/recipes.jsonl" ]]; then
  recipe_count=$(python3 -c 'import sys; print(sum(1 for line in open(sys.argv[1], encoding="utf-8") if line.strip()))' "$deploy_dir/data/recipes.jsonl")
  python3 "$deploy_dir/import-recipes.py" --input "$deploy_dir/data/recipes.jsonl" --limit "$recipe_count" --require-original-images --apply
fi
# Reapply additive migrations in filename order before application startup.
# Each migration is idempotent; repeated runs also restore restricted grants.
for migration in "$deploy_dir"/migrations/*.sql; do
  [[ -f "$migration" ]] || continue
  [[ "$migration" == */20261008_runtime_roles.sql ]] && continue
  docker exec -i supabase_db_letmecook psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <"$migration"
done
python3 "$deploy_dir/write-local-env.py"
python3 "$deploy_dir/provision-local-roles.py"
python3 "$deploy_dir/migrate-images-to-storage.py" --apply
python3 "$deploy_dir/pin-local-models.py" --apply
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" build
# Explicit neural voice provisioning writes only the reviewed speech directory.
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" run --rm --no-deps recommendation python /app/deploy-provision-local-voice.py --destination /app/model/voice/piper
# An explicit maintenance CLI validates existing cache generations before health
# waits. Missing indexes need the documented operator build, not request-time work.
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" run --rm --no-deps recommendation python -m src.cache_bootstrap --check
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" up -d --wait --wait-timeout 900
echo "Website: http://localhost:9401"
echo "Supabase Studio: http://localhost:56423"
