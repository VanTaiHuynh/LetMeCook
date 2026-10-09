from contextlib import contextmanager
import unittest

import numpy as np

from src.embedding_runtime import (OllamaEmbeddingRuntime, EmbeddingRuntimeError,
                                   DIMENSION, MODEL, QUERY_INSTRUCTION, normalize_vectors)

DIGEST = "a" * 64


class EmbeddingRuntimeTests(unittest.TestCase):
    def transport(self, events, digest=DIGEST, values=None):
        def request(path, body):
            events.append((path, body))
            if path == "/api/tags":
                return {"models": [{"name": MODEL, "digest": digest}]}
            vector = [2.] + [0.] * (DIMENSION - 1)
            return {"model": MODEL, "embeddings": values if values is not None else [vector for _ in body["input"]]}
        return request

    def test_query_instruction_plain_documents_and_shared_online_admission(self):
        events = []

        @contextmanager
        def admission():
            events.append(("admit", None))
            try: yield
            finally: events.append(("release", None))

        runtime = OllamaEmbeddingRuntime(request_fn=self.transport(events), admission=admission)
        query = runtime.embed_query("mushroom dinner", expected_digest=DIGEST)
        self.assertEqual(events[0][0], "admit")
        self.assertEqual(events[-1][0], "release")
        request = next(body for path, body in events if path == "/api/embed")
        self.assertEqual(request["input"], [f"Instruct: {QUERY_INSTRUCTION}\nQuery:mushroom dinner"])
        self.assertFalse(request["truncate"])
        self.assertEqual(request["dimensions"], 1024)
        self.assertAlmostEqual(float(np.linalg.norm(query)), 1.)
        events.clear()
        runtime.embed_documents(["Title: Mushroom rice"], expected_digest=DIGEST)
        self.assertEqual(next(body for path, body in events if path == "/api/embed")["input"], ["Title: Mushroom rice"])
        self.assertNotIn("admit", [path for path, _ in events])

    def test_model_digest_is_checked_before_and_after_each_call(self):
        events = []
        runtime = OllamaEmbeddingRuntime(request_fn=self.transport(events))
        with self.assertRaises(EmbeddingRuntimeError): runtime.embed_documents(["Rice"], expected_digest="b" * 64)
        self.assertFalse(any(path == "/api/embed" for path, _ in events))
        tags = iter([DIGEST, "b" * 64])

        def drift(path, body):
            if path == "/api/tags": return {"models": [{"name": MODEL, "digest": next(tags)}]}
            return {"model": MODEL, "embeddings": [[1.] + [0.] * (DIMENSION - 1)]}

        runtime = OllamaEmbeddingRuntime(request_fn=drift)
        with self.assertRaisesRegex(EmbeddingRuntimeError, "digest changed"):
            runtime.embed_documents(["Rice"], expected_digest=DIGEST)

    def test_dimension_count_nonfinite_zero_boolean_and_string_values_are_rejected(self):
        cases = [[[1.] * 384], [[0.] * DIMENSION], [[float("nan")] * DIMENSION],
                 [[float("inf")] * DIMENSION], [[True] * DIMENSION], [["1"] * DIMENSION], []]
        for values in cases:
            with self.subTest(values=str(values)[:30]), self.assertRaises(EmbeddingRuntimeError):
                normalize_vectors(values, 1)
        with self.assertRaises(EmbeddingRuntimeError): normalize_vectors([[1.] * DIMENSION], 2)

    def test_remote_credential_path_proxy_redirect_and_unbounded_inputs_are_not_accepted(self):
        for origin in ("https://127.0.0.1:11434", "http://example.com", "http://127.0.0.1:11434/api",
                       "http://user:password@localhost", "http://localhost?remote=true", "http://localhost:0"):
            with self.subTest(origin=origin), self.assertRaises(EmbeddingRuntimeError):
                OllamaEmbeddingRuntime(origin=origin)
        runtime = OllamaEmbeddingRuntime(request_fn=self.transport([]))
        from src.embedding_runtime import _NoRedirect
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))
        for texts in ([], [""], ["x"] * 33, ["x" * 12001]):
            with self.assertRaises(EmbeddingRuntimeError): runtime.embed_documents(texts)
        with self.assertRaises(EmbeddingRuntimeError): runtime.embed_query("rice", expected_dimension=384)

    def test_missing_wrong_or_ambiguous_model_never_triggers_a_pull(self):
        for models in ([], [{"name": "other", "digest": DIGEST}],
                       [{"name": MODEL, "digest": DIGEST}] * 2, None):
            events = []
            def request(path, body):
                events.append(path)
                return {"models": models}
            with self.assertRaises(EmbeddingRuntimeError):
                OllamaEmbeddingRuntime(request_fn=request).metadata()
            self.assertEqual(events, ["/api/tags"])


if __name__ == "__main__": unittest.main()
