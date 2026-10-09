"""Scaling regressions: full-catalog export/embedding and durable single-flight reload."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import pandas as pd
import torch

from src.cache_manager import RecipeCache
from src.download_from_supabase import export_recipes
from src import embed_with_sbert


class ScaleAndReloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.model_path = self.root / "model"
        self.data_path = self.root / "data"
        self.model_path.mkdir()
        self.data_path.mkdir()
        self.settings = patch.dict(os.environ, {
            "RECOMMENDATION_MODEL_DIR": str(self.model_path),
            "RECOMMENDATION_DATA_DIR": str(self.data_path),
            "REBUILD_CACHE_ON_START": "false",
            "RECIPE_EXPORT_BATCH_SIZE": "1000",
            "SBERT_BATCH_SIZE": "32",
        })
        self.settings.start()
        self.catalog=patch('src.local_ai.public_catalog_ids',return_value={f'recipe-{i:05d}' for i in range(10001)}|{'old-a','old-b','new-a','new-b','new-c'})
        self.catalog.start()

    def tearDown(self):
        self.settings.stop()
        self.catalog.stop()
        self.temp.cleanup()

    def test_export_consumes_every_chunk_beyond_supabase_rest_row_limit(self):
        total = 10001
        chunks = []
        for start in range(0, total, 1000):
            count = min(1000, total - start)
            chunks.append(pd.DataFrame({
                "id": [f"recipe-{index:05d}" for index in range(start, start + count)],
                "title": ["Meal"] * count, "description": ["<p>Original recipe</p>"] * count,
                "directions": ["<li>Cook</li>"] * count, "time": [10] * count, "servings": [2] * count,
                "cuisines": [None] * count, "ingredients": ["rice"] * count, "dietary_pref": [None] * count,
            }))
        engine = MagicMock()
        with patch("src.download_from_supabase.get_engine", return_value=engine), \
                patch("src.download_from_supabase.pd.read_sql", return_value=iter(chunks)) as read_sql:
            self.assertEqual(total, export_recipes())
        read_sql.assert_called_once()
        self.assertEqual(1000, read_sql.call_args.kwargs["chunksize"])
        self.assertNotIn("LIMIT", str(read_sql.call_args.args[0]).upper())
        exported = pd.read_csv(self.data_path / "recipes.csv")
        self.assertEqual(total, len(exported))
        self.assertEqual("recipe-10000", exported.iloc[-1]["id"])
        self.assertEqual("Original recipe", exported.iloc[-1]["description"])
        self.assertFalse((self.data_path / "recipes.csv.tmp").exists())

    def test_embedding_keeps_all_10001_ids_and_cpu_batch_size(self):
        total = 10001
        ids = [f"recipe-{index:05d}" for index in range(total)]
        pd.DataFrame({"id": ids, "combined_text": ["Rice meal"] * total}).to_csv(self.data_path / "recipes_cleaned.csv", index=False)
        model = MagicMock()
        model.encode.return_value = torch.zeros((total, 384))
        with patch.object(embed_with_sbert, "get_model", return_value=model):
            embed_with_sbert.main()
        self.assertEqual(total, len(model.encode.call_args.args[0]))
        self.assertEqual(32, model.encode.call_args.kwargs["batch_size"])
        self.assertEqual("cpu", model.encode.call_args.kwargs["device"])
        cached_ids, embeddings = embed_with_sbert.load_embeddings()
        self.assertEqual(ids, cached_ids)
        self.assertEqual((total, 384), tuple(embeddings.shape))

    def test_reload_rejects_concurrent_rebuild_and_installs_fresh_parent_cache_once(self):
        embed_with_sbert.save_embeddings(torch.ones((2, 384)), ["old-a", "old-b"])
        cache = RecipeCache()
        started = threading.Event()
        finish = threading.Event()
        calls = []

        def rebuild():
            calls.append(1)
            started.set()
            if not finish.wait(5):
                raise RuntimeError("test rebuild timed out")
            embed_with_sbert.save_embeddings(torch.ones((3, 384)), ["new-a", "new-b", "new-c"])

        try:
            with patch.object(cache, "_rebuild_embeddings", side_effect=rebuild):
                self.assertTrue(cache.force_reload())
                self.assertTrue(started.wait(5))
                self.assertFalse(cache.force_reload())
                self.assertEqual(["old-a", "old-b"], cache.get_data()[0])
                self.assertEqual("running", cache.get_rebuild_status()["status"])
                finish.set()
                deadline = time.monotonic() + 5
                while cache._rebuild_lock.locked() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertFalse(cache._rebuild_lock.locked())
                self.assertEqual([1], calls)
                self.assertEqual(["new-a", "new-b", "new-c"], cache.get_data()[0])
                state = cache.get_rebuild_status()
                self.assertEqual("complete", state["status"])
                self.assertEqual(3, state["recipe_count"])
        finally:
            finish.set()
            cache.shutdown()

    def test_restart_resumes_interrupted_job_even_with_an_existing_old_cache(self):
        embed_with_sbert.save_embeddings(torch.ones((2, 384)), ["old-a", "old-b"])
        (self.model_path / "rebuild_status.json").write_text(json.dumps({"status": "running", "requested_at": "previous-process"}))

        def leader(cache):
            cache._is_leader = True
            return True

        with patch.dict(os.environ, {"REBUILD_CACHE_ON_START": "true"}), \
                patch.object(RecipeCache, "_become_leader", leader), \
                patch.object(RecipeCache, "force_reload", return_value=True) as rebuild:
            cache = RecipeCache()
            try:
                rebuild.assert_called_once()
                self.assertEqual(["old-a", "old-b"], cache.get_data()[0])
            finally:
                cache.shutdown()


if __name__ == "__main__":
    unittest.main()
