#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-16}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-$OMP_NUM_THREADS}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-1}"
export TOKENIZERS_PARALLELISM=false
if [[ "${RECOMMENDATION_WORKERS:-1}" != "1" ]]; then
  printf '%s\n' 'Local inference requires exactly one Gunicorn worker.' >&2
  exit 64
fi
exec gunicorn -c gunicorn.conf.py --workers 1 --threads "${RECOMMENDATION_THREADS:-8}" \
  --bind "${RECOMMENDATION_BIND:-127.0.0.1:9501}" --timeout 180 app:app
