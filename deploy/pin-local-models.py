#!/usr/bin/env python3
"""Provision application-specific Ollama aliases without changing other models."""
import argparse
import json
import os
from pathlib import Path
import urllib.request

BASE = "http://127.0.0.1:11434"
MODELS = {
    "TEXT": {"source": "qwen3:8b", "alias": "letmecook-text:qwen3-8b-500a1f067a9f",
             "digest": "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"},
    "VISION": {"source": "qwen3-vl:4b-instruct", "alias": "letmecook-vision:qwen3-vl-4b-ee4b975b58c1",
               "digest": "ee4b975b58c17ce268cd19d40db35d5edc64603035d2ffc1fee1968eb0947f7b"},
}


def tags():
    with urllib.request.urlopen(BASE + "/api/tags", timeout=8) as response:
        return {model["name"]: model["digest"] for model in json.load(response)["models"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create missing aliases and record pins in protected local config")
    args = parser.parse_args()
    installed = tags()
    for spec in MODELS.values():
        if installed.get(spec["alias"]) not in {None, spec["digest"]}:
            raise RuntimeError("An application alias has different weights. Explicit model-version review is required.")
        if installed.get(spec["alias"]) != spec["digest"]:
            if installed.get(spec["source"]) != spec["digest"]:
                raise RuntimeError("Pinned source weights are missing. Provision the reviewed version before starting the application.")
            if args.apply:
                request = urllib.request.Request(BASE + "/api/copy",
                                                data=json.dumps({"source": spec["source"], "destination": spec["alias"]}).encode(),
                                                headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(request, timeout=20) as response:
                    response.read(1024)
    installed = tags()
    if args.apply:
        if any(installed.get(spec["alias"]) != spec["digest"] for spec in MODELS.values()):
            raise RuntimeError("Application model aliases did not verify. Runtime configuration was not changed.")
        path = Path(__file__).resolve().parent / ".env.local"
        if not path.exists():
            raise RuntimeError("Generate the protected local environment before recording model pins.")
        values = {line.split("=", 1)[0]: line.split("=", 1)[1] for line in path.read_text().splitlines()
                  if "=" in line and not line.startswith("#")}
        for kind, spec in MODELS.items():
            values["LOCAL_AI_" + kind + "_MODEL"] = spec["alias"]
            values["LOCAL_AI_" + kind + "_DIGEST"] = spec["digest"]
        os.umask(0o077)
        temporary = path.with_name(".env.models.tmp")
        temporary.write_text("".join(key + "=" + value + "\n" for key, value in values.items()))
        temporary.chmod(0o600)
        temporary.replace(path)
    print(json.dumps({"applied": args.apply, "models": [
        {"capability": kind.lower(), "alias": spec["alias"], "digest": spec["digest"],
         "verified": installed.get(spec["alias"]) == spec["digest"]} for kind, spec in MODELS.items()],
        "otherModelsUnchanged": True}))


if __name__ == "__main__":
    main()
