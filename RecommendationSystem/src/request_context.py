"""Bounded, cooperative request cancellation; no prompts or profiles are retained."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import threading
import time
import uuid
import hashlib
import hmac
import re

from src.ai_errors import AIError


class RequestStopped(AIError):
    def __init__(self, cancelled=False):
        self.code = 'request_cancelled' if cancelled else 'deadline_exceeded'
        super().__init__('Local AI request cancelled.' if cancelled else
                         'Local AI request deadline exceeded. Please retry with a narrower request.',
                         499 if cancelled else 504)


@dataclass
class RequestContext:
    request_id: str
    deadline: float
    cancelled: threading.Event = field(default_factory=threading.Event)
    closers: list = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    memo: dict = field(default_factory=dict)
    cancel_digest: str = ''

    def check(self):
        if self.cancelled.is_set():
            raise RequestStopped(True)
        if time.monotonic() >= self.deadline:
            raise RequestStopped()

    def remaining(self, maximum=None):
        self.check()
        value = self.deadline - time.monotonic()
        return min(value, maximum) if maximum is not None else value

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            for close in tuple(self.closers):
                try: close()
                except Exception: pass


_current = ContextVar('local_ai_request', default=None)
_registry = {}
_registry_lock = threading.Lock()


def current():
    return _current.get()


def checkpoint():
    value = current()
    if value is not None:
        value.check()


def remaining(maximum):
    value = current()
    return maximum if value is None else value.remaining(maximum)


@contextmanager
def request_scope(timeout_ms=150000, request_id=None, cancel_token=None):
    if type(timeout_ms) is not int or not 1000 <= timeout_ms <= 180000:
        raise AIError('Request deadline must be between 1000 and 180000 milliseconds.')
    try:
        identifier = str(uuid.UUID(request_id)) if request_id else str(uuid.uuid4())
    except (ValueError, TypeError, AttributeError) as error:
        raise AIError('Request ID must be a UUID.') from error
    value = RequestContext(identifier, time.monotonic() + timeout_ms / 1000)
    if cancel_token is not None:
        if not request_id or not isinstance(cancel_token,str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',cancel_token):
            raise AIError('Cancellation requires a request UUID and a random 32–128 character token.')
        value.cancel_digest=hashlib.sha256(cancel_token.encode()).hexdigest()
    with _registry_lock:
        if identifier in _registry:
            raise AIError('That local request ID is already active.', 409)
        _registry[identifier] = value
    token = _current.set(value)
    try:
        yield value
        value.check()
    finally:
        _current.reset(token)
        with _registry_lock:
            _registry.pop(identifier, None)


def cancel(request_id,cancel_token=None):
    try: identifier = str(uuid.UUID(request_id))
    except (ValueError, TypeError, AttributeError) as error:
        raise AIError('Request ID must be a UUID.') from error
    if not isinstance(cancel_token,str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',cancel_token):
        raise AIError('A valid cancellation token is required.',403)
    supplied=hashlib.sha256(cancel_token.encode()).hexdigest()
    with _registry_lock:
        value = _registry.get(identifier)
    if value is not None:
        if not value.cancel_digest or not hmac.compare_digest(value.cancel_digest,supplied):
            raise AIError('The cancellation token is not authorized for this request.',403)
        value.cancel()
    return {'requestId': identifier, 'cancelled': value is not None,
            'local': True, 'contractVersion': 'local-ai.v2'}


@contextmanager
def interruptible(close):
    value = current()
    if value is not None:
        value.check()
        with value.lock: value.closers.append(close)
    try:
        yield
        checkpoint()
    finally:
        if value is not None:
            with value.lock:
                if close in value.closers: value.closers.remove(close)
