import fcntl
from decimal import Decimal
import json
import io
from contextlib import redirect_stderr
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

import numpy as np

from src.embedding_runtime import DIMENSION, MODEL, QUERY_INSTRUCTION, EmbeddingRuntimeError
from src.hybrid_index import (build_index, prepare_documents, load_snapshot, get_hybrid_snapshot,
                              hybrid_status, HybridIndexError, _load_generation)

DIGEST = "a" * 64


def recipe(number, **extra):
    return {"id": str(UUID(int=number)), "is_public": True, "title": f"Recipe{number}",
            "description": "A real source recipe description", "directions": "Cook rice.",
            "ingredients": ["rice"], "cuisines": [], "categories": ["dinner"],
            "dietaryPreferences": ["vegetarian"], "cookingTime": 20, "servings": 2,
            "viewCount": 0, "ratingAverage": 0, "ratingCount": 0, **extra}


class FakeRuntime:
    def __init__(self, fail_call=None, dimension=DIMENSION, observer=None):
        self.calls = 0
        self.fail_call, self.dimension, self.observer = fail_call, dimension, observer

    def metadata(self, expected_digest=None):
        if expected_digest and expected_digest != DIGEST:
            raise EmbeddingRuntimeError("Digest mismatch")
        return {"provider": "ollama", "model": MODEL, "digest": DIGEST, "dimension": DIMENSION,
                "queryInstruction": QUERY_INSTRUCTION, "documentFormatVersion": 1,
                "normalized": True, "dtype": "float32", "numCtx": 4096}

    def embed_documents(self, texts, expected_digest=None, online=False):
        self.calls += 1
        self.metadata(expected_digest)
        if self.observer: self.observer()
        if self.calls == self.fail_call: raise EmbeddingRuntimeError("Synthetic interruption")
        values = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            number = int(text.splitlines()[0].removeprefix("Recipe"))
            values[row, number % self.dimension] = 1
        return values


class HybridIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.directory = self.root / "hybrid"
        _load_generation.cache_clear()

    def tearDown(self):
        _load_generation.cache_clear()
        self.temp.cleanup()

    def test_sorted_ids_vector_order_fingerprint_and_readonly_snapshot(self):
        snapshot = build_index([recipe(3), recipe(1), recipe(2)], FakeRuntime(), self.directory, batch_size=2)
        self.assertEqual(snapshot.recipe_ids, tuple(recipe(number)["id"] for number in (1, 2, 3)))
        self.assertEqual(snapshot.embeddings.shape, (3, 1024))
        for number in (1, 2, 3):
            self.assertEqual(snapshot.vector_for_id(recipe(number)["id"])[number], 1.)
        with self.assertRaises(ValueError): snapshot.embeddings[0, 0] = 3
        with self.assertRaises(TypeError): snapshot.documents[recipe(1)["id"]]["title"] = "Changed"
        self.assertIsInstance(snapshot.documents[recipe(1)["id"]]["ingredients"], tuple)
        self.assertEqual(load_snapshot(self.directory).manifest["catalog"]["documentFingerprint"],
                         snapshot.manifest["catalog"]["documentFingerprint"])
        self.assertEqual(hybrid_status(self.directory)["count"], 3)

    def test_revoked_best_match_is_masked_before_dense_limit_and_ties_are_stable(self):
        snapshot = build_index([recipe(3), recipe(1), recipe(2)], FakeRuntime(), self.directory)
        revoked = snapshot.vector_for_id(recipe(3)["id"])
        self.assertEqual(snapshot.dense_search(revoked, {recipe(1)["id"], recipe(2)["id"]}, limit=1),
                         [(recipe(1)["id"], 0.)])
        self.assertEqual(snapshot.dense_search(revoked, set()), [])
        self.assertEqual(snapshot.dense_search(revoked, {recipe(3)["id"]}), [(recipe(3)["id"], 1.)])
        with self.assertRaises(HybridIndexError): snapshot.dense_search(np.ones(384), set(snapshot.recipe_ids))

    def test_failed_and_resumed_batches_preserve_old_generation_and_do_not_redo_committed_rows(self):
        old = build_index([recipe(1)], FakeRuntime(), self.directory)
        legacy = self.root / "recipe_embeddings.pt"
        legacy.write_bytes(b"existing-SBERT-384-cache")
        previous_pointer = (self.directory / "CURRENT.json").read_bytes()
        with self.assertRaises(EmbeddingRuntimeError):
            build_index([recipe(1), recipe(2), recipe(3)], FakeRuntime(fail_call=2), self.directory, batch_size=1)
        self.assertEqual((self.directory / "CURRENT.json").read_bytes(), previous_pointer)
        self.assertEqual(get_hybrid_snapshot(self.directory).manifest["generation"], old.manifest["generation"])
        checkpoints = list((self.directory / "building").glob("*/progress.json"))
        self.assertEqual(len(checkpoints), 1)
        self.assertEqual(json.loads(checkpoints[0].read_text())["completed"], 1)
        observer = lambda: self.assertEqual(load_snapshot(self.directory).manifest["generation"], old.manifest["generation"])
        resumed = FakeRuntime(observer=observer)
        new = build_index([recipe(3), recipe(2), recipe(1)], resumed, self.directory, batch_size=1)
        self.assertEqual(resumed.calls, 2)
        self.assertNotEqual(new.manifest["generation"], old.manifest["generation"])
        self.assertEqual(len(old.recipe_ids), 1)
        self.assertEqual(len(new.recipe_ids), 3)
        self.assertEqual(legacy.read_bytes(), b"existing-SBERT-384-cache")

    def test_source_or_model_change_cannot_reuse_wrong_checkpoint(self):
        with self.assertRaises(EmbeddingRuntimeError):
            build_index([recipe(1), recipe(2)], FakeRuntime(fail_call=2), self.directory, batch_size=1)
        changed = FakeRuntime()
        build_index([recipe(1, description="Changed source"), recipe(2)], changed, self.directory, batch_size=1)
        self.assertEqual(changed.calls, 2)
        with self.assertRaises(EmbeddingRuntimeError):
            build_index([recipe(1)], FakeRuntime(), self.directory, expected_digest="b" * 64)

    def test_resumed_checkpoint_detects_changed_vectors_even_when_norm_dimension_and_finiteness_still_match(self):
        with self.assertRaises(EmbeddingRuntimeError):
            build_index([recipe(1), recipe(2)], FakeRuntime(fail_call=2), self.directory, batch_size=1)
        checkpoint_path = next((self.directory / "building").glob("*/progress.json"))
        matrix = np.load(checkpoint_path.parent / "embeddings.npy", mmap_mode="r+")
        matrix[0] = 0
        matrix[0, 9] = 1  # A different valid normalized1024-dimensional vector.
        matrix.flush()
        del matrix
        with self.assertRaisesRegex(HybridIndexError, "batch checksum"):
            build_index([recipe(1), recipe(2)], FakeRuntime(), self.directory, batch_size=1)
        self.assertIsNone(get_hybrid_snapshot(self.directory))

    def test_writer_lock_rejects_parallel_build_without_model_work(self):
        self.directory.mkdir()
        runtime = FakeRuntime()
        with (self.directory / "writer.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(HybridIndexError, "already active"):
                build_index([recipe(1)], runtime, self.directory)
        self.assertEqual(runtime.calls, 0)

    def test_private_profiles_unknown_time_and_duplicate_ids_are_not_indexed_as_claims(self):
        public = prepare_documents([recipe(1, cookingTime=0, private_profile={"allergies": ["peanut"]},
                                           user_prompt="private prompt")])[0]
        self.assertNotIn("private_profile", public)
        self.assertNotIn("user_prompt", public)
        self.assertNotIn("Cooking time:", public["text"])
        self.assertEqual(public["cookingTime"], 0)
        for rows in ([recipe(1, is_public=False)], [recipe(1), recipe(1)], []):
            with self.assertRaises(HybridIndexError): prepare_documents(rows)

    def test_postgres_decimal_metrics_preserve_fractional_source_values_and_reject_invalid_counts(self):
        document = prepare_documents([recipe(1, cookingTime=Decimal("20.5"), servings=Decimal("2.5"),
            viewCount=Decimal("12.0"), ratingCount=Decimal("2"), ratingAverage=Decimal("4.5"))])[0]
        self.assertEqual(document["cookingTime"], 20.5)
        self.assertEqual(document["servings"], 2.5)
        self.assertEqual(document["viewCount"], 12)
        self.assertEqual(document["ratingCount"], 2)
        self.assertEqual(document["ratingAverage"], 4.5)
        unknown = prepare_documents([recipe(1, cookingTime=None, servings=None)])[0]
        self.assertEqual(unknown["cookingTime"], 0)
        self.assertNotIn("Cooking time:", unknown["text"])
        for value in (Decimal("NaN"), Decimal("Infinity"), Decimal("-1"), True, "20"):
            with self.subTest(value=value), self.assertRaises(HybridIndexError):
                prepare_documents([recipe(1, cookingTime=value)])
        with self.assertRaises(HybridIndexError): prepare_documents([recipe(1, viewCount=Decimal("1.5"))])

    def test_wrong_dimension_and_checksum_corruption_fail_closed(self):
        with self.assertRaises(HybridIndexError):
            build_index([recipe(1)], FakeRuntime(dimension=384), self.directory)
        self.assertIsNone(get_hybrid_snapshot(self.directory))
        build_index([recipe(2)], FakeRuntime(), self.directory)
        pointer = json.loads((self.directory / "CURRENT.json").read_text())
        path = self.directory / "generations" / pointer["generation"] / "recipe_ids.json"
        path.chmod(0o644)
        path.write_text(json.dumps([recipe(1)["id"]]))
        _load_generation.cache_clear()
        self.assertIsNone(get_hybrid_snapshot(self.directory))
        self.assertEqual(hybrid_status(self.directory)["state"], "unavailable")

    def test_pointer_path_escape_and_configuration_digest_mismatch_fail_closed(self):
        self.directory.mkdir()
        (self.directory / "CURRENT.json").write_text(json.dumps({"generation": "../../escape", "manifestSha256": "a" * 64}))
        self.assertIsNone(get_hybrid_snapshot(self.directory))
        build_index([recipe(1)], FakeRuntime(), self.directory)
        with patch.dict("os.environ", {"HYBRID_EMBED_DIGEST": "b" * 64}):
            self.assertIsNone(get_hybrid_snapshot(self.directory))
        with patch.dict("os.environ", {"HYBRID_EMBED_DIGEST": "invalid"}):
            self.assertIsNone(get_hybrid_snapshot(self.directory))

    def test_offline_catalog_query_is_readonly_and_uses_current_demo_gate_not_legacy_csv(self):
        from src.build_hybrid_index import fetch_public_documents
        connection = MagicMock()
        connection.execute.return_value.mappings.return_value = [recipe(1, title="<strong>Recipe1</strong>")]
        engine = MagicMock()
        engine.connect.return_value.execution_options.return_value.__enter__.return_value = connection
        rows = fetch_public_documents(10000, engine)
        self.assertEqual(rows[0]["title"], "Recipe1")
        connection.exec_driver_sql.assert_called_once_with("SET TRANSACTION READ ONLY")
        sql, parameters = connection.execute.call_args.args
        self.assertEqual(parameters, {"limit": 10000})
        for fragment in ("r.is_public = true", "publicDemo", "demo_permission_confirmed", "ORDER BY r.id ASC"):
            self.assertIn(fragment, str(sql))
        self.assertNotIn("public.users", str(sql))

    def test_cli_unexpected_driver_failures_do_not_print_credentials_or_private_source_text(self):
        from src import build_hybrid_index as cli
        error_output = io.StringIO()
        runtime = MagicMock()
        runtime.metadata.side_effect = RuntimeError("private-password private-source-text")
        with patch("sys.argv", ["build_hybrid_index", "--dry-run"]), \
                patch.object(cli, "OllamaEmbeddingRuntime", return_value=runtime), \
                patch.object(cli, "hybrid_status", return_value={"state": "unavailable"}), \
                redirect_stderr(error_output):
            self.assertEqual(cli.main(), 1)
        output = json.loads(error_output.getvalue())
        self.assertEqual(output["status"], "failed")
        self.assertNotIn("private-password", error_output.getvalue())
        self.assertNotIn("private-source-text", error_output.getvalue())


if __name__ == "__main__": unittest.main()
