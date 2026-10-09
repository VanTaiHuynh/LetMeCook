#!/usr/bin/env bash
set -euo pipefail
command -v ollama >/dev/null || { echo 'Install Ollama from https://ollama.com, then start its local service.' >&2; exit 1; }
export OLLAMA_HOST=127.0.0.1:11434
curl --fail --silent --show-error http://127.0.0.1:11434/api/version >/dev/null
for local_model in qwen3:8b qwen3-vl:4b-instruct qwen3-embedding:0.6b; do
  if ! ollama show "$local_model" >/dev/null 2>&1; then
    ollama pull "$local_model"
  fi
done
echo 'Local text, vision and embedding models are available. Model weights are stored by the existing Ollama service.'
