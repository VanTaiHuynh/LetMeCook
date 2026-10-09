#!/usr/bin/env bash
# Rebuild the existing app with the domain configuration; credentials remain in the local env file.
set +x
set -euo pipefail
deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
docker compose --env-file "$deploy_dir/.env.local" -f "$deploy_dir/compose.yaml" -f "$deploy_dir/compose.public.yaml" up -d --build --no-deps backend web
