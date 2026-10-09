#!/usr/bin/env python3
"""Generate local runtime config from the CLI without printing credentials."""
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse

deploy = Path(__file__).resolve().parent
status = json.loads(subprocess.check_output(
    ["supabase", "status", "--workdir", str(deploy), "-o", "json"],
    stderr=subprocess.DEVNULL, text=True,
))
database = urlparse(status["DB_URL"])
values = {
    "VITE_SUPABASE_URL": status["API_URL"],
    "VITE_SUPABASE_ANON_KEY": status["ANON_KEY"],
    "SUPABASE_URL": status["API_URL"],
    "SUPABASE_JWKS_URL": status["API_URL"] + "/auth/v1/.well-known/jwks.json",
    "SUPABASE_JWT_ISSUER": status["API_URL"] + "/auth/v1",
    "SPRING_DATASOURCE_PASSWORD": unquote(database.password or ""),
    "SUPABASE_PASSWORD": unquote(database.password or ""),
}
path = deploy / ".env.local"
previous = {}
if path.exists():
    for line in path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            previous[key] = value
os.umask(0o077)
previous.update(values)
if any("\n" in value or "\r" in value for value in previous.values()):
    raise ValueError("Local environment entries must be single-line values.")
path.write_text("".join(f"{key}={value}\n" for key, value in previous.items()))
path.chmod(0o600)
print("Local environment file ready (credentials hidden).")
