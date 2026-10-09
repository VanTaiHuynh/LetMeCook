"""Bounded local speech: offline multilingual Whisper CPU + eSpeak NG WAV.

Models must be provisioned explicitly. Requests never download a model, call
cloud speech services, persist audio, or log transcripts.
"""
import base64
import hashlib
import binascii
from importlib import metadata
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import wave
import time

from src.request_context import checkpoint,remaining,interruptible

from src import local_ai as ai
from src.inference_queue import queue, QueueBusy

MODEL_PATH = os.getenv("LOCAL_STT_MODEL_PATH", "/app/model/voice/faster-whisper-base")
STT_MODEL = "faster-whisper/base"
MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_SECONDS = 60
_model = None
_model_lock = threading.Lock()
_MIMES = {"audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
          "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/m4a": "mp4"}


def _version(package):
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None


def status():
    binary = shutil.which("espeak-ng")
    tts_version = None
    if binary:
        try:
            result = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=2, check=True)
            tts_version = result.stdout.strip().splitlines()[0][:160]
        except (subprocess.SubprocessError, OSError):
            pass
    ready_files = all((Path(MODEL_PATH) / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json"))
    version = _version("faster-whisper")
    tts={'model':'espeak-ng','version':tts_version,'device':'cpu',
         'status':'ready' if tts_version else 'unavailable','quality':'formant synthesis','languages':['en','vi']}
    if os.getenv('LOCAL_TTS_ENGINE','espeak')=='piper':
        from src import piper_runtime
        tts={**piper_runtime.status(),'device':'cpu','quality':'local neural speech',
             'languages':['en']+(['vi'] if tts_version else []),
             'fallback':{'language':'vi','model':'espeak-ng','status':'ready' if tts_version else 'unavailable'}}
    return {"local": True,
            "stt": {"model": STT_MODEL, "version": version, "device": "cpu", "computeType": "int8",
                    "status": "ready" if version and ready_files else "missing_dependency" if not version else "missing_model",
                    "loaded": _model is not None, "languages": ["en", "vi"], "maxSeconds": MAX_SECONDS},
            "tts": tts}


def _audio_bytes(body):
    if not isinstance(body, dict):
        raise ai.AIError("Audio request must be a JSON object.")
    encoded = body.get("audioBase64")
    mime = body.get("mimeType")
    if not isinstance(mime, str) or mime.lower().split(";", 1)[0] not in _MIMES:
        raise ai.AIError("Use a WAV, WebM, Ogg or MP4 audio recording.")
    kind = _MIMES[mime.lower().split(";", 1)[0]]
    if not isinstance(encoded, str) or len(encoded) > 7_000_000:
        raise ai.AIError("Audio recording must be at most 5 MB.", 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ai.AIError("Audio recording is not valid base64.") from error
    if not raw or len(raw) > MAX_AUDIO_BYTES:
        raise ai.AIError("Audio recording must contain 1 byte to 5 MB.", 413)
    actual = ("wav" if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE" else
              "webm" if raw[:4] == b"\x1a\x45\xdf\xa3" else
              "ogg" if raw[:4] == b"OggS" else "mp4" if raw[4:8] == b"ftyp" else None)
    if actual != kind:
        raise ai.AIError("The recording bytes do not match a supported audio format.")
    return raw


def _decode(raw):
    """Decode incrementally: small compressed files cannot allocate hours of PCM."""
    try:
        import av
        import numpy as np
        chunks, samples = [], 0
        with av.open(io.BytesIO(raw)) as container:
            if not container.streams.audio:
                raise ai.AIError("The recording has no audio stream.")
            resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
            for frame in container.decode(audio=0):
                checkpoint()
                for normalized in resampler.resample(frame):
                    values = normalized.to_ndarray().reshape(-1)
                    samples += len(values)
                    if samples > MAX_SECONDS * 16000:
                        raise ai.AIError("Keep recordings at most 60 seconds.", 413)
                    chunks.append(values)
            for normalized in resampler.resample(None):
                values = normalized.to_ndarray().reshape(-1)
                samples += len(values)
                if samples > MAX_SECONDS * 16000:
                    raise ai.AIError("Keep recordings at most 60 seconds.", 413)
                chunks.append(values)
        if samples < 1600:
            raise ai.AIError("Record at least 0.1 seconds of speech.")
        return np.concatenate(chunks).astype(np.float32, copy=False)
    except ai.AIError:
        raise
    except ImportError as error:
        raise ai.AIError("Local speech dependencies are not installed.", 503) from error
    except Exception as error:
        raise ai.AIError("The audio recording could not be decoded.") from error


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            if not all((Path(MODEL_PATH) / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
                raise ai.AIError("Local Whisper model is not provisioned. Install the speech model before recording.", 503)
            try:
                from faster_whisper import WhisperModel
                _model = WhisperModel(MODEL_PATH, device="cpu", compute_type="int8", cpu_threads=2,
                                      num_workers=1, local_files_only=True)
            except Exception as error:
                raise ai.AIError("Local Whisper model could not be loaded.", 503) from error
        return _model


def transcribe(body):
    raw = _audio_bytes(body)
    try:
        with queue.slot("voice"):
            audio = _decode(raw)
            model = _get_model()
            try:
                segments, info = model.transcribe(audio, beam_size=3, vad_filter=True,
                                                  condition_on_previous_text=False)
                parts=[]
                for segment in segments:
                    checkpoint()
                    parts.append(segment.text.strip())
                transcript = " ".join(parts).strip()
            except ai.AIError:
                raise
            except Exception as error:
                raise ai.AIError("Local speech recognition failed. Try a clearer recording.", 503) from error
            if not transcript:
                raise ai.AIError("No speech was detected. Try a clearer recording.", 422)
            if len(transcript) > 2000:
                raise ai.AIError("Transcript is too long. Record a shorter question.", 413)
            return {"text": transcript, "model": STT_MODEL, "local": True, "device": "cpu",
                    "computeType": "int8", "version": _version("faster-whisper"),
                    "language": getattr(info, "language", None)}
    except QueueBusy as error:
        raise ai.AIError(str(error), 429) from error



def _espeak(text,language,binary):
    with tempfile.TemporaryDirectory(prefix="letmecook-voice-") as folder:
        filename=Path(folder)/"speech.wav"
        command=[binary,"-v",language,"-s","165","-w",str(filename),"--stdin"]
        process=None
        try:
            process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            started=time.monotonic();payload=text.encode('utf-8')
            with interruptible(process.kill):
                while True:
                    checkpoint()
                    if time.monotonic()-started>20:
                        raise ai.AIError('Local speech synthesis deadline exceeded.',504)
                    try:
                        process.communicate(input=payload,timeout=min(.1,remaining(20)))
                        break
                    except subprocess.TimeoutExpired:
                        payload=None
                if process.returncode:raise ai.AIError('Local speech synthesis failed.',503)
            if filename.stat().st_size>12*1024*1024:raise ai.AIError('Generated speech is too long.',413)
            return filename.read_bytes()
        except ai.AIError:raise
        except (OSError,subprocess.SubprocessError) as error:
            checkpoint()
            raise ai.AIError('Local speech synthesis failed. Please retry.',503) from error
        finally:
            if process is not None and process.poll() is None:process.kill();process.wait(timeout=2)


def speak(body):
    from src import step_audio_cache as cache
    text=body.get('text') if isinstance(body,dict) else None
    if not isinstance(text,str) or not text.strip() or len(text)>3000:
        raise ai.AIError('Speech text must contain 1–3000 characters.')
    text=text.strip()
    source=cache.verified_source(body,text)
    if len(text)>2000 and source is None and body.get('verifiedSessionStep') is not True:
        raise ai.AIError('Unverified speech text must contain at most 2000 characters.')
    language=body.get('language')
    if language is not None and language not in ('en','vi'):raise ai.AIError('Speech language must be en or vi.')
    language=language or ('vi' if re.search(r'[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]',text) else 'en')
    engine=os.getenv('LOCAL_TTS_ENGINE','espeak')
    if engine not in ('piper','espeak'):raise ai.AIError('Local speech engine is not configured.',503)
    metadata={'model':'espeak-ng','voiceId':language,'modelDigest':None,'engineVersion':_version('espeak-ng'),'language':language}
    neural=engine=='piper' and language=='en'
    if neural:
        from src import piper_runtime
        state=piper_runtime.status()
        if state.get('status')!='ready':raise ai.AIError('Pinned local neural voice is not provisioned.',503)
        metadata.update({'model':'piper','voiceId':state.get('voiceId'),'modelDigest':state.get('modelDigest'),'engineVersion':state.get('version')})
    else:
        binary=shutil.which('espeak-ng')
        if not binary:raise ai.AIError('Local eSpeak NG speech synthesis is not installed.',503)
        # Binary content distinguishes installed releases without executing or
        # persisting user speech in a version probe.
        metadata['engineVersion']=hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    key=cache.cache_key(text,source,metadata) if source else None
    raw=cache.read(key) if key else None
    hit=raw is not None
    try:
        with queue.slot('voice'):
            if raw is None:
                if neural:
                    try:result=piper_runtime.synthesize(text,cancel_check=checkpoint)
                    except (piper_runtime.SpeechUnavailable,piper_runtime.SpeechTooLong) as error:
                        raise ai.AIError('Pinned local neural speech synthesis failed or exceeded its limits.',503) from error
                    raw=result['rawBytes']
                    metadata.update({name:result.get(name) for name in ('voiceId','modelDigest','engineVersion')})
                else:raw=_espeak(text,language,binary)
                checkpoint()
                duration=cache.audio_duration(raw)
                if key:cache.write(key,raw)
            else:duration=cache.audio_duration(raw)
            return {'audioBase64':base64.b64encode(raw).decode('ascii'),'mimeType':'audio/wav',
                    **metadata,'local':True,'device':'cpu','durationSeconds':duration,'cached':hit,
                    'cachePolicy':'exact-public-source' if source else 'ephemeral',
                    'fallback':engine=='piper' and language=='vi'}
    except QueueBusy as error:raise ai.AIError(str(error),429) from error
