#!/usr/bin/env python3
"""Download the reviewed speech artifacts explicitly; inference stays offline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
VOICE_ID = "en_US-ljspeech-medium"
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/" + REVISION + "/en/en_US/ljspeech/medium/"
FILES = {
    VOICE_ID + ".onnx": {"sha256": "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22", "size": 63531379},
    VOICE_ID + ".onnx.json": {"gitOid": "73ecdec4f6ab17a437936652dfe3a925bb19e098", "size": 4972},
    "MODEL_CARD": {"gitOid": "324d7470296a501e3c6396310f9b218fdbd7ed1e", "size": 517},
}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    if args.destination.is_symlink():
        raise RuntimeError("Voice destination must not be a symlink.")
    destination = args.destination.resolve()
    if destination.exists():
        manifest = json.loads((destination / "manifest.json").read_text())
        required = set(FILES) | {"ATTRIBUTION.json"}
        if manifest.get("sourceRevision") == REVISION and manifest.get("voiceId") == VOICE_ID and manifest.get("engineVersion") == "1.8.0" and manifest.get("sampleRate") == 22050 and set(manifest.get("files", {})) == required and manifest["files"].get(VOICE_ID + ".onnx") == FILES[VOICE_ID + ".onnx"]["sha256"] and all(
                not (destination / name).is_symlink() and digest(destination / name) == value for name, value in manifest["files"].items()):
            print("Pinned local voice already verified; no download needed.")
            return
        raise RuntimeError("Existing voice differs. Do not overwrite it without explicit version review.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".piper-provision-", dir=destination.parent) as folder:
        stage = Path(folder) / "voice"
        stage.mkdir()
        for name, spec in FILES.items():
            path = stage / name
            with urllib.request.urlopen(BASE + name, timeout=45) as response, path.open("wb") as output:
                total = 0
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > spec["size"]:
                        raise RuntimeError("Voice download exceeded its pinned size.")
                    output.write(chunk)
            if total != spec["size"]:
                raise RuntimeError("Voice download has an unexpected size.")
            if "sha256" in spec:
                valid = digest(path) == spec["sha256"]
            else:
                raw = path.read_bytes()
                valid = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == spec["gitOid"]
            if not valid:
                raise RuntimeError("Voice download failed the pinned artifact checksum.")
        attribution = {
            "voiceId": VOICE_ID, "voiceRepository": "rhasspy/piper-voices", "sourceRevision": REVISION,
            "modelCard": "https://huggingface.co/rhasspy/piper-voices/blob/" + REVISION + "/en/en_US/ljspeech/medium/MODEL_CARD",
            "repositoryLicenseMetadata": "MIT", "datasetLicenseAsModelCardStates": "public domain",
            "engine": "piper-tts 1.8.0", "engineLicense": "GPL-3.0",
            "engineSource": "https://github.com/OHF-Voice/piper1-gpl",
            "scope": "Records source declarations for this voice; it does not grant rights for recipe text/photos.",
        }
        (stage / "ATTRIBUTION.json").write_text(json.dumps(attribution, indent=2) + "\n")
        manifest = {"voiceId": VOICE_ID, "sampleRate": 22050, "language": "en", "sourceRevision": REVISION,
                    "engineVersion": "1.8.0", "files": {p.name: digest(p) for p in stage.iterdir()}}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        for path in stage.iterdir():
            path.chmod(0o444)
        stage.chmod(0o755)
        os.replace(stage, destination)
    print("Pinned English neural voice provisioned and checksummed. Inference does not download models.")


if __name__ == "__main__":
    main()
