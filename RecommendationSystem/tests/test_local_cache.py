"""Regression checks for a new local database and upstream incomplete model files."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd
import torch

from src.clean_data import clean_and_export
from src.embed_with_sbert import append_embedding, load_embeddings, remove_embeddings
from src.cache_manager import RecipeCache


class LocalCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model_path = Path(self.temp.name) / "model"
        self.data_path = Path(self.temp.name) / "data"
        self.model_path.mkdir()
        self.data_path.mkdir()
        self.settings = patch.dict(os.environ, {
            "RECOMMENDATION_MODEL_DIR": str(self.model_path),
            "RECOMMENDATION_DATA_DIR": str(self.data_path),
            "REBUILD_CACHE_ON_START": "false",
        })
        self.settings.start()
        self.catalog=patch('src.local_ai.public_catalog_ids',return_value={'first-local-recipe','second-local-recipe'})
        self.catalog.start()

    def tearDown(self):
        self.settings.stop()
        self.catalog.stop()
        self.temp.cleanup()

    def test_missing_recipe_ids_ignores_upstream_orphan_embeddings(self):
        torch.save(torch.ones((10, 384)), self.model_path / "recipe_embeddings.pt")
        cache = RecipeCache()
        try:
            ids, embeddings = cache.get_data()
            self.assertEqual([], ids)
            self.assertEqual((0, 384), tuple(embeddings.shape))
            self.assertEqual(0, cache.get_cache_info()["recipe_count"])
        finally:
            cache.shutdown()

    def test_empty_database_cleaning_and_embedding_does_not_download_model(self):
        from src import embed_with_sbert
        columns = ["id", "title", "description", "time", "servings", "ingredients", "directions", "cuisines", "dietary_pref"]
        pd.DataFrame(columns=columns).to_csv(self.data_path / "recipes.csv", index=False)
        clean_and_export()
        with patch.object(embed_with_sbert, "get_model", side_effect=AssertionError("No model download for empty data")):
            embed_with_sbert.main()
        ids, embeddings = load_embeddings()
        self.assertEqual([], ids)
        self.assertEqual((0, 384), tuple(embeddings.shape))

    def test_incremental_embeddings_work_without_an_exported_dataset(self):
        with patch("src.embed_with_sbert.embed_texts", return_value=torch.ones((1, 384))):
            vector = append_embedding("first-local-recipe", "recipe description")
            self.assertEqual((384,), tuple(vector.shape))
            append_embedding("second-local-recipe", "another recipe")
        ids, embeddings = load_embeddings()
        self.assertEqual(["first-local-recipe", "second-local-recipe"], ids)
        self.assertEqual((2, 384), tuple(embeddings.shape))
        remove_embeddings(["first-local-recipe"])
        ids, embeddings = load_embeddings()
        self.assertEqual(["second-local-recipe"], ids)
        self.assertEqual((1, 384), tuple(embeddings.shape))


if __name__ == "__main__":
    unittest.main()
