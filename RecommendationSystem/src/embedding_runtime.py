"""Pinned, local Ollama embeddings; no downloads, user cache, or global settings."""
from contextlib import nullcontext
from functools import lru_cache
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

MODEL = "qwen3-embedding:0.6b"
DIMENSION = 1024
QUERY_INSTRUCTION = "Given a recipe request, retrieve relevant cooking recipes that match the requested dish and ingredients."
MAX_BATCH = 32
MAX_TEXT_CHARS = 12000


class EmbeddingRuntimeError(RuntimeError):
    pass


def canonical_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:sha256:)?[0-9a-f]{64}", value):
        raise EmbeddingRuntimeError("An exact SHA-256 model digest is required")
    return value.removeprefix("sha256:")


def loopback_origin(value):
    parsed = urllib.parse.urlparse(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise EmbeddingRuntimeError("Invalid local Ollama port") from error
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or port is not None and not 1 <= port <= 65535):
        raise EmbeddingRuntimeError("Embedding Ollama endpoint must be an HTTP loopback origin")
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def normalize_vectors(values, rows, dimension=DIMENSION):
    try:
        if any(isinstance(value, bool) or not isinstance(value, (int, float, np.number))
               for row in values for value in row):
            raise ValueError("Nonnumeric embedding")
        vectors = np.asarray(values, dtype=np.float32)
    except (ValueError, TypeError, OverflowError) as error:
        raise EmbeddingRuntimeError("Embedding response contains invalid numbers") from error
    if vectors.shape != (rows, dimension) or not np.isfinite(vectors).all():
        raise EmbeddingRuntimeError("Embedding response dimension/count/finite-value validation failed")
    norms = np.linalg.norm(vectors.astype(np.float64), axis=1)
    if not np.isfinite(norms).all() or np.any(norms <= 1e-12):
        raise EmbeddingRuntimeError("Embedding response contains an empty vector")
    return np.asarray(vectors / norms[:, None], dtype=np.float32)


class OllamaEmbeddingRuntime:
    def __init__(self, origin=None, model=None, expected_digest=None, timeout=None,
                 request_fn=None, admission=None):
        self.origin = loopback_origin(origin or os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"))
        self.model = model or os.getenv("HYBRID_EMBED_MODEL", MODEL)
        if self.model != MODEL:
            raise EmbeddingRuntimeError("This index version requires qwen3-embedding:0.6b")
        pin = expected_digest or os.getenv("HYBRID_EMBED_DIGEST")
        self.expected_digest = canonical_digest(pin) if pin else None
        self.timeout = float(timeout if timeout is not None else os.getenv("HYBRID_EMBED_TIMEOUT_SECONDS", "90"))
        if not 5 <= self.timeout <= 180:
            raise EmbeddingRuntimeError("Embedding timeout must be between 5 and 180 seconds")
        self._request_fn = request_fn
        self._admission = admission
        # Do not inherit HTTP_PROXY or follow a local response to a remote URL.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    def _request(self, path, body=None):
        if self._request_fn:
            return self._request_fn(path, body)
        payload = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(self.origin + path, data=payload,
                                         headers={"Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=min(10, self.timeout) if body is None else self.timeout) as response:
                data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise EmbeddingRuntimeError("Embedding response exceeded its size bound")
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ValueError("Object required")
            return result
        except (urllib.error.URLError, OSError, TimeoutError, ValueError) as error:
            raise EmbeddingRuntimeError("Local embedding model is unavailable or returned invalid data") from error

    def metadata(self, expected_digest=None):
        models = self._request("/api/tags").get("models", [])
        if not isinstance(models, list):
            raise EmbeddingRuntimeError("Local model metadata is invalid")
        matches = [item for item in models if isinstance(item, dict) and
                   self.model in {item.get("name"), item.get("model")}]
        if len(matches) != 1:
            raise EmbeddingRuntimeError("Embedding model is not installed unambiguously; provision it explicitly")
        digest = canonical_digest(matches[0].get("digest"))
        pins = [pin for pin in (self.expected_digest, expected_digest) if pin]
        if any(digest != canonical_digest(pin) for pin in pins):
            raise EmbeddingRuntimeError("Embedding model digest changed; rebuild an index with an explicitly approved digest")
        return {"provider": "ollama", "model": self.model, "digest": digest,
                "dimension": DIMENSION, "queryInstruction": QUERY_INSTRUCTION,
                "documentFormatVersion": 1, "normalized": True, "dtype": "float32", "numCtx": 4096}

    def _slot(self, online):
        if not online:
            return nullcontext()
        if self._admission:
            return self._admission()
        from src.inference_queue import queue
        return queue.slot("text")

    def embed_documents(self, texts, expected_digest=None, online=False):
        if not isinstance(texts, (list, tuple)) or not 1 <= len(texts) <= MAX_BATCH:
            raise EmbeddingRuntimeError("Embedding batch must contain 1–32 texts")
        if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS for text in texts):
            raise EmbeddingRuntimeError("Embedding texts must contain 1–12000 characters")
        with self._slot(online):
            metadata = self.metadata(expected_digest)
            response = self._request("/api/embed", {"model": self.model, "input": list(texts),
                "truncate": False, "dimensions": DIMENSION, "keep_alive": "5m", "options": {"num_ctx": 4096}})
            if response.get("model") != self.model:
                raise EmbeddingRuntimeError("Embedding response model does not match the pinned encoder")
            vectors = normalize_vectors(response.get("embeddings", []), len(texts))
            # A tag is mutable: bracket every call with actual full digest checks.
            self.metadata(metadata["digest"])
            return vectors

    def embed_query(self, query, expected_digest=None, expected_dimension=DIMENSION):
        if expected_dimension != DIMENSION:
            raise EmbeddingRuntimeError("Query dimension cannot be mixed with another encoder")
        if not isinstance(query, str) or not query.strip() or len(query) > 2000:
            raise EmbeddingRuntimeError("Embedding query must contain 1–2000 characters")
        text = f"Instruct: {QUERY_INSTRUCTION}\nQuery:{query.strip()}"
        return self.embed_documents([text], expected_digest, online=True)[0]


@lru_cache(maxsize=1)
def get_default_runtime():
    return OllamaEmbeddingRuntime()
