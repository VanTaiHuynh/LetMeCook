"""Fresh authorization and bounded transport regressions for hybrid ranking."""
import importlib
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src import recommend


class RecommendationEligibilityTests(unittest.TestCase):
    def test_actual_ranker_keeps_seen_seeds_for_interests_but_never_returns_them(self):
        import numpy as np
        from src.hybrid_ranking import HybridRanker
        seed, unrelated, match = [str(uuid.UUID(int=value)) for value in (1, 2, 3)]
        order = (seed, unrelated, match)
        vectors = np.zeros((3, 1024), dtype=np.float32)
        vectors[0, 0] = vectors[2, 0] = vectors[1, 1] = 1
        documents = {seed: {"title": "Tomato basil pasta", "ingredients": ["tomato", "basil", "pasta"]},
                     match: {"title": "Fresh tomato pasta", "ingredients": ["tomato", "basil", "pasta"]},
                     unrelated: {"title": "Chocolate cake", "ingredients": ["chocolate", "flour"], "viewCount": 10000}}
        positions = {value: row for row, value in enumerate(order)}
        snapshot = SimpleNamespace(recipe_ids=order, embeddings=vectors, documents=documents, id_to_row=positions)
        snapshot.dense_search = lambda query, allowed, limit: sorted(
            [(value, float(np.dot(query, vectors[positions[value]]))) for value in allowed],
            key=lambda pair: (-pair[1], pair[0]))[:limit]
        ranker = HybridRanker(snapshot)
        with patch.object(recommend, "public_catalog_ids", return_value=set(order)), \
                patch.object(recommend, "_get_hybrid_ranker", return_value=ranker):
            result = recommend.recommend_for_user([seed], [], eligible_ids={unrelated, match},
                                                 excluded_ids={seed}, top_k=1)
        self.assertEqual([match], [value for value, _ in result])

    def test_newly_public_seed_uses_existing_similarity_until_hybrid_refresh(self):
        ranker = MagicMock(); ranker.id_to_row = {}
        with patch.object(recommend, "public_catalog_ids", return_value={"new-public", "other"}), \
                patch.object(recommend, "_get_hybrid_ranker", return_value=ranker), \
                patch.object(recommend, "_legacy_recommend_by_id", return_value=[("other", 0.5)]) as fallback:
            self.assertEqual([("other", 0.5)], recommend.recommend_by_id("new-public", 1))
        fallback.assert_called_once_with("new-public", 1)
        ranker.recommend_by_id.assert_not_called()

    def test_fresh_catalog_and_account_masks_precede_retrieval(self):
        ranker = MagicMock()
        ranker.recommend_for_user.return_value = [("allowed", 0.7)]
        with patch.object(recommend, "public_catalog_ids", return_value={"seed", "allowed", "excluded", "wrong-diet"}), \
                patch.object(recommend, "_get_hybrid_ranker", return_value=ranker):
            result = recommend.recommend_for_user(["seed", "withdrawn"], ["seed"],
                eligible_ids={"allowed", "excluded", "withdrawn"}, excluded_ids={"excluded"})
        self.assertEqual([("allowed", 0.7)], result)
        args, kwargs = ranker.recommend_for_user.call_args
        self.assertEqual(["seed"], args[0])
        self.assertEqual({"allowed"}, args[2])
        self.assertEqual({"excluded", "seed"}, kwargs["excluded_ids"])

    def test_no_eligible_candidates_skips_all_retrieval(self):
        with patch.object(recommend, "public_catalog_ids", return_value={"public"}), \
                patch.object(recommend, "_get_hybrid_ranker") as ranker:
            self.assertEqual([], recommend.recommend_for_user([], [], eligible_ids={"withdrawn"}))
            ranker.assert_not_called()

    def test_unavailable_index_retains_same_hard_mask_in_legacy_fallback(self):
        with patch.object(recommend, "public_catalog_ids", return_value={"seed", "allowed", "wrong-diet"}), \
                patch.object(recommend, "_get_hybrid_ranker", return_value=None), \
                patch.object(recommend, "_legacy_recommend_for_user", return_value=[]) as fallback:
            recommend.recommend_for_user(["seed"], [], eligible_ids={"allowed"}, excluded_ids={"disliked"})
        self.assertEqual({"allowed"}, fallback.call_args.kwargs["eligible_ids"])
        self.assertEqual({"seed", "disliked"}, fallback.call_args.kwargs["excluded_ids"])

    def test_withdrawn_recipe_is_rejected_before_similarity(self):
        with patch.object(recommend, "public_catalog_ids", return_value={"other"}), \
                patch.object(recommend, "_get_hybrid_ranker") as ranker:
            with self.assertRaises(ValueError):
                recommend.recommend_by_id("withdrawn")
            ranker.assert_not_called()


class RecommendationHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import the actual Flask routes while preventing live cache initialization,
        # signal registration and shutdown hooks in this disposable test process.
        with patch("src.cache_manager.get_cache", return_value=MagicMock()), \
                patch("signal.signal"), patch("atexit.register"):
            cls.module = importlib.import_module("app")
        cls.client = cls.module.app.test_client()
        cls.seed, cls.allowed, cls.excluded = [str(uuid.uuid4()) for _ in range(3)]

    def payload(self):
        return {"favorites": [], "history": [], "eligibleIds": [self.allowed],
                "excludedIds": [self.excluded], "dietaryPreferences": ["vegetarian"], "topK": 10}

    def test_cold_start_uses_trusted_complete_context_without_echoing_profile(self):
        body = self.payload()
        body["eligibleIds"] *= 2
        with patch.object(self.module, "recommend_for_user", return_value=[(self.allowed, 0.6)]) as rank:
            response = self.client.post("/recommend/user", json=body)
        self.assertEqual(200, response.status_code)
        self.assertEqual({"recommendations": [[self.allowed, 0.6]], "count": 1}, response.json)
        self.assertEqual([self.allowed], rank.call_args.kwargs["eligible_ids"])
        self.assertEqual([self.excluded], rank.call_args.kwargs["excluded_ids"])

    def test_missing_eligibility_identity_and_invalid_limits_cannot_trigger_ranking(self):
        cases = []
        value = self.payload(); value.pop("eligibleIds"); cases.append(value)
        value = self.payload(); value["userId"] = self.seed; cases.append(value)
        for limit in (True, 0, 101, 1.5):
            value = self.payload(); value["topK"] = limit; cases.append(value)
        for ids in ("not-an-array", ["not-a-uuid"], [None], [self.allowed] * 20001):
            value = self.payload(); value["eligibleIds"] = ids; cases.append(value)
        with patch.object(self.module, "recommend_for_user") as rank:
            for value in cases:
                with self.subTest(keys=list(value)):
                    self.assertEqual(400, self.client.post("/recommend/user", json=value).status_code)
            rank.assert_not_called()

    def test_legacy_get_rejects_nonfinite_weights_and_invalid_ids(self):
        for query in (f"favorites={self.seed}&favWeight=nan", f"favorites={self.seed}&histWeight=inf", "favorites=private-id", "favorites=x&topK=oops"):
            with self.subTest(query=query), patch.object(self.module, "recommend_for_user") as rank:
                self.assertEqual(400, self.client.get("/recommend/user?" + query).status_code)
                rank.assert_not_called()


if __name__ == "__main__":
    unittest.main()
