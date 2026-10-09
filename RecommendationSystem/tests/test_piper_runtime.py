import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

from src import piper_runtime as speech


def wav_bytes(channels=1):
    sink = io.BytesIO()
    with wave.open(sink, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"\0\0" * 1000 * channels)
    return sink.getvalue()


class FakeProcess:
    def __init__(self, raw=None, wait=False):
        self.returncode = None if wait else 0
        self.raw = raw or wav_bytes()
        self.wait = wait
        self.killed = False

    def communicate(self, input=None, timeout=None):
        if self.wait and not self.killed:
            raise subprocess.TimeoutExpired("speech", timeout)
        return self.raw, b""

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


class PiperRuntimeTests(unittest.TestCase):
    def ready(self):
        return {"status": "ready", "version": "1.8.0", "modelDigest": speech.MODEL_SHA256}

    def test_missing_voice_is_unavailable_without_spawning_inference(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(speech, "VOICE_ROOT", Path(folder)), \
                patch.object(speech, "_version", return_value="1.8.0"), patch.object(speech.subprocess, "Popen") as spawn:
            self.assertEqual(speech.status()["reason"], "pinned_voice_missing_or_invalid")
            with self.assertRaises(speech.SpeechUnavailable):
                speech.synthesize("Step one.")
            spawn.assert_not_called()
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_self_consistent_manifest_cannot_select_unreviewed_model(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(speech, "VOICE_ROOT", Path(folder)), \
                patch.object(speech, "_version", return_value="1.8.0"):
            root = Path(folder)
            names = [speech.VOICE_ID + ".onnx", speech.VOICE_ID + ".onnx.json", "MODEL_CARD", "ATTRIBUTION.json"]
            for name in names:
                (root / name).write_bytes(b"different model")
            files = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}
            (root / "manifest.json").write_text(json.dumps({"voiceId": speech.VOICE_ID, "sampleRate": 22050,
                "sourceRevision": speech.SOURCE_REVISION, "engineVersion": "1.8.0", "files": files}))
            self.assertEqual(speech.status()["status"], "unavailable")

    def test_dependency_version_drift_fails_before_artifact_reads(self):
        with patch.object(speech, "_version", return_value="1.9.0"), patch.object(speech, "_manifest") as read:
            self.assertEqual(speech.status()["reason"], "pinned_piper_dependency_missing")
            read.assert_not_called()

    def test_cancel_terminates_owned_process_and_does_not_return_audio(self):
        process = FakeProcess(wait=True)
        checks = 0
        def cancel():
            nonlocal checks
            checks += 1
            if checks == 3:
                raise RuntimeError("Request cancelled")
        with patch.object(speech, "status", side_effect=self.ready), \
                patch.object(speech.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(RuntimeError, "Request cancelled"):
                speech.synthesize("Step one.", cancel_check=cancel)
        self.assertTrue(process.killed)

    def test_parent_deadline_terminates_synthesis(self):
        process = FakeProcess(wait=True)
        with patch.object(speech, "status", side_effect=self.ready), \
                patch.object(speech.subprocess, "Popen", return_value=process), \
                patch.object(speech.time, "monotonic", side_effect=[0, 26]):
            with self.assertRaisesRegex(speech.SpeechUnavailable, "deadline"):
                speech.synthesize("Step one.")
        self.assertTrue(process.killed)

    def test_returned_audio_must_be_mono_pcm_at_reviewed_rate(self):
        process = FakeProcess(wav_bytes(channels=2))
        with patch.object(speech, "status", side_effect=self.ready), \
                patch.object(speech.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(speech.SpeechUnavailable, "unsupported audio format"):
                speech.synthesize("Step one.")

    def test_valid_bounded_audio_records_actual_engine_and_digest(self):
        process = FakeProcess()
        with patch.object(speech, "status", side_effect=self.ready), \
                patch.object(speech.subprocess, "Popen", return_value=process):
            result = speech.synthesize("Step one.")
        self.assertEqual(result["rawBytes"], process.raw)
        self.assertEqual(result["modelDigest"], speech.MODEL_SHA256)
        self.assertGreater(result["durationSeconds"], 0)


if __name__ == "__main__":
    unittest.main()
