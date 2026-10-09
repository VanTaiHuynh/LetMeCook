import base64
import io
from pathlib import Path
import shutil
from types import SimpleNamespace
import unittest
from unittest.mock import patch,MagicMock
import wave
from src import local_voice as voice
from src import local_ai as ai


def wav(seconds=.2):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(seconds * 16000))
    return output.getvalue()


class LocalVoiceTests(unittest.TestCase):
    def test_audio_bounds_magic_and_mime_before_any_inference(self):
        for body in [{"audioBase64": "not-base64", "mimeType": "audio/wav"},
                     {"audioBase64": base64.b64encode(b"<html>photo</html>").decode(), "mimeType": "audio/wav"},
                     {"audioBase64": "a" * 7_000_001, "mimeType": "audio/webm"},
                     {"audioBase64": base64.b64encode(wav()).decode(), "mimeType": "image/jpeg"},
                     {"audioBase64": base64.b64encode(wav()).decode(), "mimeType": "audio/ogg"}]:
            with patch.object(voice, "_decode", side_effect=AssertionError("Invalid bytes")):
                with self.assertRaises(ai.AIError):
                    voice.transcribe(body)
        self.assertEqual(wav(), voice._audio_bytes({"audioBase64": base64.b64encode(wav()).decode(), "mimeType": "audio/wav;codecs=1"}))

    def test_transcript_uses_model_segments_and_reports_cpu_truthfully(self):
        model = SimpleNamespace(transcribe=lambda *_args, **_kwargs: (
            iter([SimpleNamespace(text="  Heat the oven."), SimpleNamespace(text="Bake for twenty minutes. ")]),
            SimpleNamespace(language="en")))
        with patch.object(voice, "_decode", return_value=[0.0] * 16000), patch.object(voice, "_get_model", return_value=model):
            result = voice.transcribe({"audioBase64": base64.b64encode(wav()).decode(), "mimeType": "audio/wav"})
        self.assertEqual("Heat the oven. Bake for twenty minutes.", result["text"])
        self.assertEqual("cpu", result["device"])
        self.assertEqual("int8", result["computeType"])
        self.assertTrue(result["local"])

    def test_missing_model_never_triggers_network_download(self):
        with patch.object(voice, "_model", None), patch.object(voice, "MODEL_PATH", "/missing-local-voice-test-model"):
            with self.assertRaises(ai.AIError) as error:
                voice._get_model()
        self.assertEqual(503, error.exception.status)

    def test_silence_returns_explicit_retry_instead_of_fake_transcript(self):
        model = SimpleNamespace(transcribe=lambda *_args, **_kwargs: (iter([]), SimpleNamespace(language="en")))
        with patch.object(voice, "_decode", return_value=[0.0]), patch.object(voice, "_get_model", return_value=model):
            with self.assertRaises(ai.AIError) as error:
                voice.transcribe({"audioBase64": base64.b64encode(wav()).decode(), "mimeType": "audio/wav"})
        self.assertEqual(422, error.exception.status)

    def test_tts_passes_plain_text_as_stdin_validates_wav_and_deletes_temp_audio(self):
        files = []
        def synthesis(command, **kwargs):
            self.assertNotIn("shell", kwargs)
            target = Path(command[command.index("-w") + 1])
            files.append(target)
            process=MagicMock(returncode=0)
            process.poll.return_value=0
            def communicate(**options):
                self.assertEqual(b"--help; $(touch /tmp/never-execute)", options["input"])
                target.write_bytes(wav())
            process.communicate.side_effect=communicate
            return process
        with patch.object(voice.shutil, "which", return_value="/usr/bin/espeak-ng"), patch.object(voice.subprocess, "Popen", side_effect=synthesis):
            result = voice.speak({"text": "--help; $(touch /tmp/never-execute)"})
        self.assertEqual(wav(), base64.b64decode(result["audioBase64"]))
        self.assertEqual("audio/wav", result["mimeType"])
        self.assertFalse(files[0].exists())

    def test_tts_text_bounds_and_missing_binary_are_visible(self):
        for text in [None, "", "a" * 2001]:
            with self.assertRaises(ai.AIError):
                voice.speak({"text": text})
        with patch.object(voice.shutil, "which", return_value=None):
            with self.assertRaises(ai.AIError) as error:
                voice.speak({"text": "Read this step."})
        self.assertEqual(503, error.exception.status)

    @unittest.skipUnless(shutil.which("espeak-ng"), "eSpeak NG not installed in test environment")
    def test_actual_local_tts_produces_decodable_nonempty_wav(self):
        result = voice.speak({"text": "Heat the oven and bake for twenty minutes."})
        raw = base64.b64decode(result["audioBase64"])
        with wave.open(io.BytesIO(raw), "rb") as audio:
            self.assertGreater(audio.getnframes(), 16000)
            self.assertGreater(len(audio.readframes(audio.getnframes())), 16000)

    def test_decode_duration_is_bounded_even_for_small_compressed_upload(self):
        try:
            import av  # noqa: F401
        except ImportError:
            self.skipTest("PyAV not installed in test environment")
        with self.assertRaises(ai.AIError) as error:
            voice._decode(wav(61))
        self.assertEqual(413, error.exception.status)


if __name__ == "__main__":
    unittest.main()
