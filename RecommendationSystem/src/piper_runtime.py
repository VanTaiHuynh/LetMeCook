"""Pinned, offline neural speech in a bounded child process.

Provisioning is an operator action. Neither readiness nor synthesis downloads
weights. Text is sent through stdin and is never logged or persisted here.
"""
import hashlib
import io
import json
from importlib import metadata
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import wave

VOICE_ID = "en_US-ljspeech-medium"
SOURCE_REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
MODEL_SHA256 = "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22"
VOICE_ROOT = Path(os.getenv("LOCAL_PIPER_MODEL_DIR", "/app/model/voice/piper"))
MAX_WAV_BYTES = 12 * 1024 * 1024
MAX_DURATION_SECONDS = 180
MAX_SYNTHESIS_SECONDS = 25
_verified = None
_lock = threading.Lock()


class SpeechUnavailable(RuntimeError):
    pass


class SpeechTooLong(ValueError):
    pass


def _version():
    try:
        return metadata.version("piper-tts")
    except metadata.PackageNotFoundError:
        return None


def _digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(part)
    return value.hexdigest()


def _manifest():
    global _verified
    manifest_path = VOICE_ROOT / "manifest.json"
    try:
        stat = manifest_path.stat()
        if stat.st_size > 16384:
            raise ValueError("Oversized manifest")
        spec = json.loads(manifest_path.read_text())
        if (spec.get("voiceId") != VOICE_ID or spec.get("sampleRate") != 22050
                or spec.get("sourceRevision") != SOURCE_REVISION or spec.get("engineVersion") != "1.8.0"):
            raise ValueError("Unsupported voice")
        files = spec.get("files", {})
        expected_names = {VOICE_ID + ".onnx", VOICE_ID + ".onnx.json", "MODEL_CARD", "ATTRIBUTION.json"}
        if set(files) != expected_names:
            raise ValueError("Incomplete voice manifest")
        if files[VOICE_ID + ".onnx"] != MODEL_SHA256:
            raise ValueError("Unreviewed voice model weights")
        paths = {name: VOICE_ROOT / name for name in files}
        if any(path.is_symlink() or not path.is_file() for path in paths.values()):
            raise ValueError("Missing voice artifacts")
        fingerprint = tuple((name, paths[name].stat().st_size, paths[name].stat().st_mtime_ns)
                            for name in sorted(paths)) + (("manifest", stat.st_size, stat.st_mtime_ns),)
        with _lock:
            if _verified != fingerprint:
                if any(_digest(paths[name]) != digest for name, digest in files.items()):
                    raise ValueError("Voice checksum mismatch")
                _verified = fingerprint
        return spec
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        raise SpeechUnavailable("The pinned local Piper voice is not provisioned or failed checksum validation.") from error


def status():
    version = _version()
    if version != "1.8.0":
        return {"status": "unavailable", "reason": "pinned_piper_dependency_missing", "model": "piper",
                "version": version, "voiceId": VOICE_ID, "device": "cpu", "languages": ["en"]}
    try:
        spec = _manifest()
    except SpeechUnavailable:
        return {"status": "unavailable", "reason": "pinned_voice_missing_or_invalid", "model": "piper",
                "version": version, "voiceId": VOICE_ID, "device": "cpu", "languages": ["en"]}
    return {"status": "ready", "model": "piper", "version": version, "voiceId": VOICE_ID,
            "modelDigest": spec["files"][VOICE_ID + ".onnx"], "sourceRevision": spec["sourceRevision"],
            "device": "cpu", "languages": ["en"], "quality": "local neural synthesis"}


def synthesize(text, cancel_check=None):
    """Return a checked mono WAV; cancellation kills the owned child process."""
    if not isinstance(text, str) or not text.strip() or len(text) > 3000:
        raise ValueError("Speech text must contain 1–3000 characters.")
    details = status()
    if details["status"] != "ready":
        raise SpeechUnavailable("The pinned local Piper engine and voice must be provisioned before reading steps.")
    if cancel_check:
        cancel_check()
    env = {**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "1"}
    process = subprocess.Popen([sys.executable, "-m", "src.piper_runtime", "--worker"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=env)
    started = time.monotonic()
    pending = text.strip().encode("utf-8")
    try:
        while True:
            if cancel_check:
                cancel_check()
            if time.monotonic() - started > MAX_SYNTHESIS_SECONDS:
                raise SpeechUnavailable("Local neural speech exceeded its deadline. Please retry.")
            try:
                raw, _ = process.communicate(input=pending, timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                pending = None
        if process.returncode == 3:
            raise SpeechTooLong("Generated speech exceeds three minutes. Split this passage into shorter parts.")
        if process.returncode or not raw or len(raw) > MAX_WAV_BYTES:
            raise SpeechUnavailable("Local neural speech did not return valid bounded audio.")
        with wave.open(io.BytesIO(raw), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 22050:
                raise SpeechUnavailable("Local neural speech returned an unsupported audio format.")
            duration = wav.getnframes() / wav.getframerate()
            if not 0 < duration <= MAX_DURATION_SECONDS:
                raise SpeechTooLong("Generated speech exceeds three minutes.")
        return {"rawBytes": raw, "voiceId": VOICE_ID, "modelDigest": details["modelDigest"],
                "engineVersion": details["version"], "language": "en", "durationSeconds": round(duration, 3)}
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def _worker():
    # A separate process bounds both inference time and memory lifetime. Do not
    # import Piper until dependency and artifact validation succeeded.
    text = sys.stdin.buffer.read(12001).decode("utf-8")
    if not text.strip() or len(text) > 3000:
        return 2
    if status()["status"] != "ready":
        return 2
    import onnxruntime as ort
    from piper import PiperVoice
    from piper.config import PiperConfig

    # Piper owns its CPU session; use explicit session settings rather than all
    # 104 host threads. The worker is isolated from the recipe-ranking process.
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    config = PiperConfig.from_dict(json.loads((VOICE_ROOT / (VOICE_ID + ".onnx.json")).read_text()))
    voice = PiperVoice(config=config,
                       session=ort.InferenceSession(str(VOICE_ROOT / (VOICE_ID + ".onnx")),
                                                    sess_options=options, providers=["CPUExecutionProvider"]),
                       download_dir=VOICE_ROOT, use_tashkeel=False)
    sink = io.BytesIO()
    frames = 0
    with wave.open(sink, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        for chunk in voice.synthesize(text):
            if chunk.sample_rate != 22050 or chunk.sample_width != 2 or chunk.sample_channels != 1:
                return 2
            frames += len(chunk.audio_int16_bytes) // 2
            if frames > MAX_DURATION_SECONDS * 22050 or sink.tell() > MAX_WAV_BYTES:
                return 3
            wav.writeframes(chunk.audio_int16_bytes)
    sys.stdout.buffer.write(sink.getvalue())
    return 0


if __name__ == "__main__":
    if sys.argv[1:] != ["--worker"]:
        raise SystemExit("Use the configured local speech API.")
    try:
        raise SystemExit(_worker())
    except (SpeechUnavailable, ValueError, OSError):
        raise SystemExit(2)
