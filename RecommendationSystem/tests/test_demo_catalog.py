import unittest
from unittest.mock import MagicMock, patch
from src import local_ai as ai
from src import meal_planner


class DemoCatalogTests(unittest.TestCase):
    def test_every_public_gate_reads_current_flag_and_requires_declared_original_local_image(self):
        clause = ai.public_catalog_clause("recipe")
        for expected in ["recipe.is_public = true", "settings->>'publicDemo'", "lmc_platform_settings",
                         "demo_permission_confirmed = true", "btrim(coalesce(recipe.demo_permission_note",
                         "recipe.image_kind = 'source'", "recipe.image_url LIKE '/recipe-images/%'"]:
            self.assertIn(expected, clause)
        self.assertIn(", true)", clause)  # Missing settings are gated, never a silent private-testing fallback.
        with self.assertRaises(ValueError):
            ai.public_catalog_clause("recipe;DROP TABLE recipe")

    def test_catalog_permissions_are_rechecked_instead_of_cached(self):
        connection = MagicMock()
        connection.execute.side_effect = [[("first",), ("second",)], [("second",)]]
        engine = MagicMock()
        engine.connect.return_value.__enter__.return_value = connection
        with patch.object(ai, "_db", return_value=engine):
            self.assertEqual({"first", "second"}, ai.public_catalog_ids())
            self.assertEqual({"second"}, ai.public_catalog_ids())
        self.assertEqual(2, connection.execute.call_count)

    def test_search_and_planner_share_identical_catalog_gate_before_ranking(self):
        connection = MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = []
        engine = MagicMock()
        engine.connect.return_value.__enter__.return_value = connection
        intent = {"keyword": "", **{key: [] for key in ai.ARRAY_FIELDS}, "maxCookingTime": 30}
        with patch.object(ai, "_db", return_value=engine), patch.object(ai, "parse_intent", return_value=intent):
            ai.search("dinner")
            search_sql = str(connection.execute.call_args.args[0])
            meal_planner._eligible_rows(intent, [])
            plan_sql = str(connection.execute.call_args.args[0])
        self.assertIn(ai.public_catalog_clause(), search_sql)
        self.assertIn(ai.public_catalog_clause(), plan_sql)
        self.assertIn("r.time > 0", plan_sql)

    def test_cached_recommendations_cannot_leak_unapproved_ids_and_refill_from_eligible_rank(self):
        import torch
        from src import recommend
        cache = MagicMock()
        cache.get_snapshot.return_value = (["seed", "unapproved", "approved"],
            torch.tensor([[1., 0.], [.999, .001], [.1, 1.]]))
        with patch.object(recommend, "get_cache", return_value=cache), patch.object(recommend, "public_catalog_ids", return_value={"seed", "approved"}):
            self.assertEqual(["approved"], [rid for rid, _ in recommend.recommend_by_id("seed", 1)])
            self.assertEqual(["approved"], [rid for rid, _ in recommend.recommend_for_user(["seed"], [], top_k=1)])
            with self.assertRaises(ValueError):
                recommend.recommend_by_id("unapproved", 1)
            self.assertEqual([], recommend.recommend_for_user(["unapproved"], []))
        cache.add_recipe_to_cache.assert_not_called()


if __name__ == "__main__":
    unittest.main()
