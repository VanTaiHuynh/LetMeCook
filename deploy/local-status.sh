#!/usr/bin/env bash
set -euo pipefail
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" ps
curl -fsS http://127.0.0.1:9401/ >/dev/null && echo "Website: OK"
curl -fsS 'http://127.0.0.1:9401/api/recipes?size=1' >/dev/null && echo "Recipes API: OK"
curl -fsS http://127.0.0.1:9501/ && echo
