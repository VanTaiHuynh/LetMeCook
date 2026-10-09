"""Compatibility facade for versioned local intelligence domain modules.

Public entry points and injectable legacy names stay stable. The implementation
is split into transport, intent, catalog and reviewed photo observations.
"""
import threading
from src.ai_config import *
from src.ai_errors import AIError
from src.database import get_engine
from src.inference_queue import queue, QueueBusy
_gate = threading.BoundedSemaphore(1)
_engine = None


def _db():
    global _engine
    if _engine is None:
        _engine = get_engine()
    return _engine


def _ollama(path, body=None, timeout=120):
    from src.ai_transport import ollama
    return ollama(path, body, timeout)


def _chat(model, system, content, schema, images=None, priority=None):
    from src.ai_transport import chat
    return chat(model, system, content, schema, images, priority)


def _chat_unqueued(model, system, content, schema, images=None, priority=None):
    from src.ai_transport import chat_unqueued
    return chat_unqueued(model, system, content, schema, images, priority)


def _terms(value, limit=10):
    from src.ai_intent import _terms as implementation
    return implementation(value, limit)


def parse_intent(prompt, *, clarified=False):
    from src.ai_intent import parse_intent as implementation
    return implementation(prompt,clarified=clarified)


def vision(image_base64):
    from src.ai_vision import vision as implementation
    return implementation(image_base64)


def ingredient_pattern(term):
    from src.ai_catalog import ingredient_pattern as implementation
    return implementation(term)


def public_catalog_clause(alias="r"):
    from src.ai_catalog import public_catalog_clause as implementation
    return implementation(alias)


def public_catalog_ids():
    from src.ai_catalog import public_catalog_ids as implementation
    return implementation()


def search(prompt, confirmed_ingredients=None, clarification_context=None, clarification_answers=None):
    from src.ai_catalog import search as implementation
    return implementation(prompt, confirmed_ingredients, clarification_context, clarification_answers)


def _rank(rows, intent):
    from src.ai_catalog import _rank as implementation
    return implementation(rows, intent)


def status():
    from src.readiness import status as implementation
    return implementation()
