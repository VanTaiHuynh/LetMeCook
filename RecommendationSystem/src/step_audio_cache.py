"""Bounded local audio cache for exact freshly public source steps only."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import uuid
import wave

from sqlalchemy import text as sql
from src import local_ai as ai
from src.request_context import checkpoint,RequestStopped

MAX_BYTES=12*1024*1024
MAX_SECONDS=180
_lock=threading.Lock()


def audio_duration(raw):
    if not isinstance(raw,bytes) or len(raw)>MAX_BYTES:raise ai.AIError('Generated speech is too long.',413)
    try:
        with wave.open(io.BytesIO(raw),'rb') as audio:
            rate,frames=audio.getframerate(),audio.getnframes()
            if audio.getnchannels()!=1 or rate<=0 or frames<=0 or frames/rate>MAX_SECONDS:raise ValueError()
            return frames/rate
    except (wave.Error,EOFError,ValueError) as error:raise ai.AIError('Local speech returned invalid or overlong WAV audio.',503) from error


def source_steps(value):
    from bs4 import BeautifulSoup
    # Match the authenticated Java session's li-first, then br/block/newline
    # splitting. Inline tags are text, never spoken markup or executable data.
    source=str(value or '')
    sanitized=re.sub(r'<(script|style|noscript)\b[^>]*>.*?</\1\s*>','',source,flags=re.I|re.S)
    soup=BeautifulSoup(sanitized,'html.parser')
    nodes=soup.find_all('li')
    if nodes:
        for node in nodes:
            for line_break in node.find_all('br'):line_break.replace_with(' ')
            for block in node.find_all(['p','div','h1','h2','h3','h4','h5','h6']):
                block.insert_before(' ');block.insert_after(' ')
        values=[node.get_text() for node in nodes]
    else:
        broken=re.sub(r'<br\s*/?\s*>|</(?:p|div|h[1-6])\s*>','\n',sanitized,flags=re.I)
        values=[BeautifulSoup(part,'html.parser').get_text() for part in re.split(r'\r?\n|[\u2028\u2029]',broken)]
    return [' '.join(item.split()) for item in values if item.strip()]


def verified_source(body,text):
    if body.get('cachePublicSource') is not True:return None
    try:identifier=str(uuid.UUID(body.get('sourceRecipeId')))
    except (ValueError,TypeError,AttributeError):return None
    index=body.get('sourceStepIndex')
    if type(index) is not int or not 0<=index<60:return None
    checkpoint()
    with ai._db().connect() as connection:
        value=connection.execute(sql('SELECT r.directions FROM public.recipe r WHERE r.id::text=:id AND '+ai.public_catalog_clause()),{'id':identifier}).scalar()
    if value is None:return None
    steps=source_steps(value)
    if index>=len(steps) or ' '.join(text.split())!=steps[index]:return None
    return identifier


def directory():
    return Path(os.getenv('RECOMMENDATION_MODEL_DIR','model'))/'voice-step-audio'


def cache_key(text,source,engine):
    fields={key:engine.get(key) for key in ('model','voiceId','modelDigest','engineVersion','language')}
    return hashlib.sha256(json.dumps({'text':text,'sourceRecipeId':source,**fields},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def read(key):
    path=directory()/(key+'.wav')
    try:
        if path.is_symlink() or path.stat().st_size>MAX_BYTES:return None
        raw=path.read_bytes();audio_duration(raw);checkpoint()
        return raw
    except FileNotFoundError:return None
    except RequestStopped:raise
    except (OSError,ai.AIError):
        path.unlink(missing_ok=True)
        return None


def write(key,raw):
    audio_duration(raw);checkpoint()
    root=directory();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with _lock:
        path=None
        try:
            with tempfile.NamedTemporaryFile(dir=root,prefix='.audio-',delete=False) as handle:
                path=Path(handle.name);handle.write(raw);handle.flush();os.fsync(handle.fileno())
            path.chmod(0o600);path.replace(root/(key+'.wav'))
            entries=sorted((item for item in root.glob('*.wav') if re.fullmatch(r'[0-9a-f]{64}\.wav',item.name) and not item.is_symlink()),key=lambda item:item.stat().st_mtime_ns)
            total=sum(item.stat().st_size for item in entries)
            while entries and (len(entries)>256 or total>128*1024*1024):
                item=entries.pop(0);total-=item.stat().st_size;item.unlink()
        finally:
            if path is not None:path.unlink(missing_ok=True)
