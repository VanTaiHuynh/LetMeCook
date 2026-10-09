"""One bounded inference lane per worker process; cooking questions go first.

Run Gunicorn with one process. Waiting callers retain no prompts in this queue.
The active model call is never interrupted; priority orders waiting requests.
"""
from contextlib import contextmanager
from contextvars import ContextVar
import heapq
import itertools
import os
import threading
import time


class QueueBusy(Exception):
    pass


_task_kind = ContextVar("inference_task_kind", default="text")
_held_queue = ContextVar("held_inference_queue", default=None)
_charged = ContextVar("inference_rate_charged", default=False)
_allow_reentry = ContextVar("inference_reentry_allowed", default=False)
PRIORITY = {"cook": 0, "voice": 5, "text": 10, "vision": 10, "plan": 10}


@contextmanager
def task(kind):
    token = _task_kind.set(kind)
    try:
        yield
    finally:
        _task_kind.reset(token)


class InferenceQueue:
    def __init__(self, capacity=4, wait_seconds=25, requests_per_minute=30, burst=8):
        self.capacity = max(1, min(16, int(capacity)))
        self.wait_seconds = max(0, min(30, float(wait_seconds)))
        self.rate = max(1, float(requests_per_minute)) / 60
        self.burst = max(1, int(burst))
        self._tokens = float(self.burst)
        self._refill_at = time.monotonic()
        self._condition = threading.Condition()
        self._waiting = []
        self._sequence = itertools.count()
        self._active = None
        self._completed = 0
        self._rejected = 0
        self._total_wait = self._max_wait = 0.0
        self._total_service = self._max_service = 0.0

    @contextmanager
    def slot(self, kind=None, rate_limit=True, reentrant=False):
        from src.request_context import checkpoint, remaining as request_remaining
        checkpoint()
        if _held_queue.get() is self and _allow_reentry.get():
            if rate_limit and not _charged.get():
                with self._condition:
                    self._refill_tokens()
                    if self._tokens < 1:
                        self._rejected += 1
                        raise QueueBusy('Local AI is busy. Please retry shortly.')
                    self._tokens -= 1
                _charged.set(True)
            yield
            checkpoint()
            return
        kind = kind or _task_kind.get()
        entry = (PRIORITY.get(kind, 10), next(self._sequence), kind)
        arrived = time.monotonic()
        deadline = arrived + request_remaining(self.wait_seconds)
        with self._condition:
            self._refill_tokens()
            if len(self._waiting) + bool(self._active) >= self.capacity or rate_limit and self._tokens < 1:
                self._rejected += 1
                raise QueueBusy("Local AI is busy. Please retry shortly.")
            if rate_limit:self._tokens -= 1
            heapq.heappush(self._waiting, entry)
            while self._active is not None or self._waiting[0] != entry:
                try:
                    checkpoint()
                except Exception:
                    self._waiting.remove(entry)
                    heapq.heapify(self._waiting)
                    self._condition.notify_all()
                    raise
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._waiting.remove(entry)
                    heapq.heapify(self._waiting)
                    self._rejected += 1
                    self._condition.notify_all()
                    raise QueueBusy("Local AI queue wait expired. Please retry shortly.")
                self._condition.wait(min(remaining, .1))
            heapq.heappop(self._waiting)
            self._active = kind
            admitted = time.monotonic()
            wait = max(0.0, admitted - arrived)
            self._total_wait += wait
            self._max_wait = max(self._max_wait, wait)
        token = _held_queue.set(self)
        rate_token = _charged.set(rate_limit)
        reentry_token = _allow_reentry.set(reentrant)
        try:
            yield
            checkpoint()
        finally:
            _held_queue.reset(token)
            _charged.reset(rate_token)
            _allow_reentry.reset(reentry_token)
            with self._condition:
                self._active = None
                self._completed += 1
                service = max(0.0, time.monotonic() - admitted)
                self._total_service += service
                self._max_service = max(self._max_service, service)
                self._condition.notify_all()

    def _refill_tokens(self):
        now=time.monotonic()
        self._tokens=min(self.burst,self._tokens+(now-self._refill_at)*self.rate)
        self._refill_at=now

    def status(self):
        with self._condition:
            return {"active": self._active, "queued": len(self._waiting),
                    "capacity": self.capacity, "waitSeconds": self.wait_seconds,
                    "completed": self._completed, "rejected": self._rejected,
                    "timingSeconds": {"totalWait": round(self._total_wait, 3), "maxWait": round(self._max_wait, 3),
                                     "totalService": round(self._total_service, 3), "maxService": round(self._max_service, 3)},
                    "priority": "cook before queued voice/text/vision/plan"}


queue = InferenceQueue(os.getenv("LOCAL_AI_QUEUE_CAPACITY", "4"),
                       os.getenv("LOCAL_AI_QUEUE_WAIT_SECONDS", "25"),
                       os.getenv("LOCAL_AI_REQUESTS_PER_MINUTE", "30"))
