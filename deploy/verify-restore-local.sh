#!/usr/bin/env bash
set -euo pipefail
: "${1:?Pass the path created by backup-local.sh}"
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/verify-restore-local.py" "$1"
