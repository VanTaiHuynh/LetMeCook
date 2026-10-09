"""Immutable SBERT cache generations. The volume lock serializes every publisher."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from uuid import uuid4

import torch

MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
DIMENSION = 384
_mutex = threading.RLock()
_held = threading.local()


class CacheInvalid(RuntimeError):
    pass


class CacheBusy(RuntimeError):
    pass


class ModelUnavailable(RuntimeError):
    pass


def directory():
    return Path(os.getenv('RECOMMENDATION_MODEL_DIR', 'model')) / 'legacy-sbert'


def revision():
    value = os.getenv('SBERT_REVISION', REVISION)
    if value != REVISION:
        raise ModelUnavailable('SBERT revision differs from the provisioned release; provision and migrate explicitly.')
    if os.getenv('SBERT_MODEL', MODEL) not in (MODEL, 'all-MiniLM-L6-v2'):
        raise ModelUnavailable('This release supports only its pinned 384-dimensional SBERT model.')
    return value


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _hash(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024), b''):
            result.update(chunk)
    return result.hexdigest()


def _fsync(path):
    fd = os.open(path, os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def _write(path, value):
    with path.open('xb') as handle:
        handle.write(value);handle.flush();os.fsync(handle.fileno())


@contextmanager
def writer_lock(wait_seconds=None):
    """Reentrant in one thread; advisory flock also covers other processes."""
    root=directory();root.mkdir(parents=True,exist_ok=True)
    wait=float(os.getenv('LEGACY_CACHE_LOCK_WAIT_SECONDS','30') if wait_seconds is None else wait_seconds)
    if not 0 <= wait <= 120:raise ValueError('Cache lock wait must be between0 and120 seconds')
    deadline=time.monotonic()+wait
    if not _mutex.acquire(timeout=wait):raise CacheBusy('Legacy cache publisher is busy. Retry later.')
    try:
        held=getattr(_held,'paths',None)
        if held is None:_held.paths=held={}
        key=str(root.resolve())
        if key in held:
            yield
            return
        fd=os.open(root/'.writer.lock',os.O_CREAT|os.O_RDWR,0o600)
        try:
            while True:
                try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if time.monotonic()>=deadline:raise CacheBusy('Legacy cache publisher is busy. Retry later.')
                    time.sleep(min(.05,max(0,deadline-time.monotonic())))
            held[key]=fd
            yield
        finally:
            held.pop(key,None)
            fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
    finally:
        _mutex.release()


def generation_name():
    try:
        value=(directory()/'CURRENT').read_text().strip()
    except FileNotFoundError:return None
    if len(value)!=32 or any(c not in '0123456789abcdef' for c in value):
        raise CacheInvalid('Legacy cache pointer is invalid')
    return value


def current_lineage():
    name=generation_name()
    if name is None:return None
    return json.loads((directory()/name/'manifest.json').read_text()).get('lineage')


def validate(embeddings, ids):
    if not isinstance(ids,list) or len(ids)>50000 or any(not isinstance(i,str) or not i or len(i)>128 for i in ids):
        raise CacheInvalid('Legacy cache IDs are invalid')
    if len(ids)!=len(set(ids)):raise CacheInvalid('Legacy cache contains duplicate IDs')
    if not isinstance(embeddings,torch.Tensor) or embeddings.ndim!=2 or tuple(embeddings.shape)!=(len(ids),DIMENSION):
        raise CacheInvalid('Legacy cache ID order and384-dimensional matrix do not match')
    if embeddings.dtype!=torch.float32 or not torch.isfinite(embeddings).all():
        raise CacheInvalid('Legacy cache matrix must contain finite float32 values')


def publish(embeddings,ids,lineage=None):
    validate(embeddings,ids);revision()
    with writer_lock():
        root=directory();name=uuid4().hex
        stage=root/('.building-'+name);stage.mkdir(mode=0o700)
        target=root/name
        try:
            _write(stage/'ids.json',_json(ids))
            with (stage/'embeddings.pt').open('xb') as handle:
                torch.save(embeddings.detach().cpu().contiguous(),handle);handle.flush();os.fsync(handle.fileno())
            manifest={'schema':1,'generation':name,'createdAt':datetime.now(timezone.utc).isoformat(),
                      'encoder':{'model':MODEL,'revision':revision(),'dimension':DIMENSION},
                      'count':len(ids),'dtype':'float32','checksums':{p:_hash(stage/p) for p in ('ids.json','embeddings.pt')}}
            from src.artifact_lineage import unknown_lineage,canonical_hash
            manifest['lineage']=lineage if lineage is not None else unknown_lineage(ids)
            if manifest['lineage'].get('dataset',{}).get('idOrderSha256')!=canonical_hash(ids):
                raise CacheInvalid('Semantic input lineage ID order differs from its vectors')
            _write(stage/'manifest.json',_json(manifest));_fsync(stage)
            stage.rename(target);_fsync(root)
            for child in target.iterdir():child.chmod(0o400)
            pointer=root/('.CURRENT-'+name)
            _write(pointer,(name+'\n').encode());pointer.replace(root/'CURRENT');_fsync(root)
            return name
        finally:
            if stage.exists():
                for child in stage.iterdir():child.unlink()
                stage.rmdir()
            (root/('.CURRENT-'+name)).unlink(missing_ok=True)


def load():
    """No implicit flat-file import. Bad published generations fail closed."""
    name=generation_name()
    if name is None:return [],torch.empty((0,DIMENSION))
    root=directory()/name
    try:
        manifest=json.loads((root/'manifest.json').read_text())
        if (manifest.get('schema')!=1 or manifest.get('generation')!=name or
            manifest.get('encoder')!={'model':MODEL,'revision':revision(),'dimension':DIMENSION} or manifest.get('dtype')!='float32'):
            raise CacheInvalid('Legacy cache manifest/model revision mismatch')
        if manifest.get('checksums')!={p:_hash(root/p) for p in ('ids.json','embeddings.pt')}:
            raise CacheInvalid('Legacy cache checksum mismatch')
        ids=json.loads((root/'ids.json').read_text())
        vectors=torch.load(root/'embeddings.pt',map_location='cpu',weights_only=True)
        validate(vectors,ids)
        if manifest.get('count')!=len(ids):raise CacheInvalid('Legacy cache manifest count mismatch')
        if 'lineage' in manifest:
            from src.artifact_lineage import canonical_hash
            dataset=manifest['lineage'].get('dataset',{})
            if dataset.get('count')!=len(ids) or dataset.get('idOrderSha256')!=canonical_hash(ids):
                raise CacheInvalid('Legacy semantic lineage ID order mismatch')
            if manifest['lineage'].get('historicalInputsKnown'):
                inputs=dataset.get('inputs')
                if (not isinstance(inputs,list) or [item.get('id') for item in inputs]!=ids or
                        dataset.get('semanticInputSha256')!=canonical_hash(inputs)):
                    raise CacheInvalid('Legacy semantic input fingerprint mismatch')
            elif 'knownInputs' in dataset:
                known=dataset['knownInputs']
                if (not isinstance(known,list) or len({item.get('id') for item in known})!=len(known) or
                        any(item.get('id') not in ids for item in known) or dataset.get('semanticInputSha256')!=canonical_hash(known)):
                    raise CacheInvalid('Legacy incremental semantic input fingerprint mismatch')
        return ids,vectors
    except (CacheInvalid,ModelUnavailable):raise
    except Exception as error:raise CacheInvalid('Legacy cache generation is incomplete or invalid') from error
