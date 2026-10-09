"""Meaningful synthetic regressions for permission masks and ranking behavior."""
import math
import unittest
from unittest.mock import patch

import numpy as np

from src.hybrid_index import HybridSnapshot
from src.hybrid_ranking import HybridRanker, MAX_POOL
from hybrid_fixtures import SyntheticSnapshot, document, two_interest_snapshot
from evaluate_hybrid_ranking import ndcg_at_k, recall_at_k


class HybridRankingTests(unittest.TestCase):
    def test_production_snapshot_contract_accepts_the_rankers_mask_and_vectors(self):
        fixture = two_interest_snapshot()
        vectors = np.zeros((len(fixture.recipe_ids), 1024), dtype=np.float32)
        vectors[:, :fixture.embeddings.shape[1]] = fixture.embeddings
        vectors.setflags(write=False)
        snapshot = HybridSnapshot(fixture.manifest, fixture.recipe_ids, fixture.documents,
                                  vectors, fixture.id_to_row)
        result = HybridRanker(snapshot).recommend_for_user(["seed-savory", "seed-sweet"], [],
                                                          snapshot.recipe_ids, excluded_ids=("savory-b",), top_k=2)
        self.assertEqual({"savory-a", "sweet-a"}, {recipe_id for recipe_id, _ in result})

    def test_dense_and_sparse_can_each_supply_real_retrieval_evidence(self):
        snapshot = SyntheticSnapshot([
            document("literal", "Mushroom rice", ingredients=("mushroom",)),
            document("semantic", "Forest grain bowl", ingredients=("shiitake",)),
            document("unrelated", "Chocolate pudding")], [[0, 1], [1, 0], [0, -1]])
        allowed = set(snapshot.recipe_ids)
        sparse = HybridRanker(snapshot, dense_weight=0, diversity_lambda=1).rank_query("mushroom", [1, 0], allowed)
        dense = HybridRanker(snapshot, dense_weight=1, diversity_lambda=1).rank_query("mushroom", [1, 0], allowed)
        hybrid = HybridRanker(snapshot, diversity_lambda=1).rank_query("mushroom", [1, 0], allowed)
        self.assertEqual("literal", sparse.recommendations[0][0])
        self.assertEqual("semantic", dense.recommendations[0][0])
        self.assertEqual({"literal", "semantic"}, {recipe_id for recipe_id, _ in hybrid.recommendations})
        self.assertGreater(hybrid.metadata["retrievalEvidence"]["dense"], 0)
        self.assertGreater(hybrid.metadata["retrievalEvidence"]["sparse"], 0)

    def test_vietnamese_text_can_use_dense_evidence_without_english_keyword_overlap(self):
        snapshot = SyntheticSnapshot([document("rice", "Mushroom rice"), document("cake", "Chocolate cake")], [[1, 0], [0, 1]])
        result = HybridRanker(snapshot).rank_query("món cơm nấm", [1, 0], snapshot.recipe_ids)
        self.assertEqual("rice", result.recommendations[0][0])
        self.assertEqual(0, result.metadata["retrievalEvidence"]["sparse"])
        self.assertGreater(result.metadata["retrievalEvidence"]["dense"], 0)

    def test_equal_fusion_preserves_exact_lexical_match_among_dense_distractors(self):
        snapshot = SyntheticSnapshot([
            document("literal", "Mushroom rice", ingredients=("mushroom",)),
            document("semantic", "Forest grain bowl", ingredients=("shiitake",)),
            document("unrelated", "Chocolate cake")], [[0, 1], [1, 0], [0.8, 0.2]])
        result = HybridRanker(snapshot).rank_query("mushroom", [1, 0], snapshot.recipe_ids, top_k=2)
        self.assertEqual({"literal", "semantic"}, {recipe_id for recipe_id, _ in result.recommendations})

    def test_multi_interest_profiles_do_not_cancel_opposite_tastes_into_a_centroid(self):
        snapshot = two_interest_snapshot()
        result = HybridRanker(snapshot).rank_for_user(["seed-savory", "seed-sweet"], [], snapshot.recipe_ids, top_k=2)
        self.assertEqual({"savory-a", "sweet-a"}, {recipe_id for recipe_id, _ in result.recommendations})
        self.assertEqual(2, result.metadata["interestsUsed"])

    def test_favorites_have_more_weight_than_history_and_are_not_counted_twice(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot, diversity_lambda=1)
        without_repeat = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], snapshot.recipe_ids)
        repeated = ranker.rank_for_user(["seed-savory", "seed-savory"], ["seed-savory", "seed-sweet", "seed-sweet"], snapshot.recipe_ids)
        self.assertEqual(without_repeat.recommendations, repeated.recommendations)
        scores = dict(without_repeat.recommendations)
        self.assertGreater(scores["savory-a"], scores["sweet-a"])
        self.assertEqual(2, repeated.metadata["interestsUsed"])

    def test_mmr_chooses_a_relevant_different_recipe_before_an_almost_duplicate(self):
        snapshot = SyntheticSnapshot([
            document("seed", "Dinner"), document("best", "Dinner A", ingredients=("mushroom", "rice")),
            document("clone", "Dinner B", ingredients=("mushroom", "rice")),
            document("diverse", "Dinner C", ingredients=("tofu", "noodle"))],
            [[1, 0, 0], [1, 0, 0], [1, 0.01, 0], [0.9, 0, 0.4]])
        plain = HybridRanker(snapshot, diversity_lambda=1).recommend_by_id("seed", snapshot.recipe_ids, top_k=2)
        diverse = HybridRanker(snapshot, diversity_lambda=0.6).recommend_by_id("seed", snapshot.recipe_ids, top_k=2)
        self.assertEqual(["best", "clone"], [recipe_id for recipe_id, _ in plain])
        self.assertEqual(["best", "diverse"], [recipe_id for recipe_id, _ in diverse])

    def test_permission_mask_is_applied_before_dense_retrieval_and_seed_reads(self):
        snapshot = SyntheticSnapshot([
            document("revoked", "Secret mushroom recipe", ingredients=("mushroom",)),
            document("public-seed", "Mushroom"), document("allowed", "Mushroom rice")], [[1, 0], [1, 0], [1, 0]])
        ranker = HybridRanker(snapshot)
        snapshot.documents.forbidden = {"revoked"}
        result = ranker.rank_for_user(["revoked", "public-seed"], [], {"public-seed", "allowed"})
        self.assertEqual(["allowed"], [recipe_id for recipe_id, _ in result.recommendations])
        self.assertTrue(all(call == {"allowed"} for call in snapshot.dense_calls))
        self.assertNotIn("revoked", str(result.metadata))
        with self.assertRaises(ValueError):
            ranker.recommend_by_id("revoked", {"public-seed", "allowed"})

    def test_candidate_only_server_mask_uses_separately_visible_public_seeds(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot)
        candidates = set(snapshot.recipe_ids) - {"seed-savory", "seed-sweet"}
        result = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], candidates,
                                     visible_seed_ids=snapshot.recipe_ids)
        self.assertEqual("personalized", result.metadata["mode"])
        self.assertTrue(result.metadata["personalized"])
        self.assertEqual(2, result.metadata["interestsUsed"])
        self.assertTrue(set(recipe_id for recipe_id, _ in result.recommendations) <= candidates)
        self.assertTrue(all(call == candidates for call in snapshot.dense_calls))
        fail_closed = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], candidates)
        self.assertEqual("cold_start", fail_closed.metadata["mode"])

    def test_separate_seed_mask_revocation_is_applied_before_seed_features_are_read(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot)
        snapshot.documents.forbidden = {"seed-savory"}
        visible = set(snapshot.recipe_ids) - {"seed-savory"}
        candidates = set(snapshot.recipe_ids) - {"seed-savory", "seed-sweet"}
        result = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], candidates,
                                     visible_seed_ids=visible,
                                     excluded_ids=("seed-savory", "seed-sweet", "savory-a"))
        self.assertEqual(1, result.metadata["interestsUsed"])
        self.assertTrue(result.metadata["personalized"])
        self.assertNotIn("seed-savory", str(result.metadata))
        self.assertTrue(all(not call & {"seed-savory", "seed-sweet", "savory-a"}
                            for call in snapshot.dense_calls))

    def test_seen_candidate_exclusions_do_not_revoke_explicitly_visible_profile_seeds(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot)
        candidates = set(snapshot.recipe_ids) - {"seed-savory", "seed-sweet"}
        excluded = {"seed-savory", "seed-sweet", "savory-b"}
        result = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], candidates,
                                     excluded_ids=excluded, visible_seed_ids=snapshot.recipe_ids)
        self.assertEqual("personalized", result.metadata["mode"])
        self.assertTrue(result.metadata["personalized"])
        self.assertEqual(2, result.metadata["interestsUsed"])
        self.assertTrue(set(recipe_id for recipe_id, _ in result.recommendations) <= candidates - excluded)
        self.assertTrue(all(call == candidates - excluded for call in snapshot.dense_calls))
        fail_closed = ranker.rank_for_user(["seed-savory"], ["seed-sweet"], snapshot.recipe_ids,
                                          excluded_ids=excluded)
        self.assertEqual("cold_start", fail_closed.metadata["mode"])
        self.assertFalse(fail_closed.metadata["personalized"])

    def test_dislikes_history_favorites_and_self_are_excluded_before_retrieval(self):
        snapshot = two_interest_snapshot()
        result = HybridRanker(snapshot).recommend_for_user(["seed-savory"], ["seed-sweet"], snapshot.recipe_ids,
                                                         excluded_ids=("savory-a",))
        self.assertTrue(set(recipe_id for recipe_id, _ in result) <= {"savory-b", "sweet-a", "other"})
        self.assertTrue(all(not call & {"seed-savory", "seed-sweet", "savory-a"} for call in snapshot.dense_calls))

    def test_sparse_idf_and_document_length_do_not_use_revoked_rows(self):
        small = SyntheticSnapshot([document("a", "Mushroom rice"), document("b", "Rice stew")], [[1, 0], [0, 1]])
        large = SyntheticSnapshot([document("a", "Mushroom rice"), document("b", "Rice stew")]
                                  + [document(f"revoked-{i}", "Mushroom " * 50) for i in range(30)],
                                  [[1, 0], [0, 1]] + [[1, 0]] * 30)
        first = HybridRanker(small)._sparse("mushroom rice", {"a", "b"})
        second = HybridRanker(large)._sparse("mushroom rice", {"a", "b"})
        self.assertEqual(first, second)

    def test_entire_eligible_catalog_is_retrieved_before_bounded_pool_reranking(self):
        documents = [document("seed", "Mushroom")]
        vectors = [[1, 0]]
        for index in range(350):
            documents.append(document(f"recipe-{index:04d}", "Other food"))
            vectors.append([0, 1])
        documents.append(document("winner-at-end", "Mushroom rice"))
        vectors.append([1, 0])
        snapshot = SyntheticSnapshot(documents, vectors)
        result = HybridRanker(snapshot).rank_by_id("seed", snapshot.recipe_ids, top_k=1)
        self.assertEqual("winner-at-end", result.recommendations[0][0])
        self.assertEqual(351, len(snapshot.dense_calls[0]))
        self.assertLessEqual(result.metadata["candidatePoolSize"], MAX_POOL)

    def test_cold_start_uses_actual_popularity_without_fake_personalization(self):
        snapshot = SyntheticSnapshot([
            document("popular", "Rice", views=100, rating=4.8, rating_count=20),
            document("unreviewed", "Cake"), document("invalid-score", "Pasta", rating=9, rating_count=20)],
            [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        result = HybridRanker(snapshot).rank_for_user([], [], snapshot.recipe_ids)
        self.assertEqual("popular", result.recommendations[0][0])
        self.assertEqual("cold_start", result.metadata["mode"])
        self.assertFalse(result.metadata["personalized"])
        self.assertEqual(0, result.metadata["interestsUsed"])
        self.assertEqual([], snapshot.dense_calls)
        self.assertNotIn("local_dense_embedding", result.metadata["methods"])
        self.assertIn("source_popularity", result.metadata["methods"])

    def test_context_rerank_is_bounded_after_full_catalog_retrieval(self):
        documents = [document("seed", "Mushroom")]
        documents += [document(f"recipe-{index:04d}", "Mushroom rice") for index in range(350)]
        snapshot = SyntheticSnapshot(documents, [[1, 0]] * len(documents))
        ranker = HybridRanker(snapshot)
        with patch.object(ranker, "_context", wraps=ranker._context) as context:
            result = ranker.rank_by_id("seed", snapshot.recipe_ids)
        self.assertEqual(350, len(snapshot.dense_calls[0]))
        self.assertEqual(MAX_POOL, result.metadata["candidatePoolSize"])
        self.assertEqual(MAX_POOL, context.call_count)

    def test_cold_pool_keeps_a_source_category_outside_the_popularity_head(self):
        documents = [document(f"rice-{index:04d}", "Rice", views=100, categories=("dinner",)) for index in range(240)]
        documents.append(document("dessert", "Berry cake", views=1, categories=("dessert",)))
        snapshot = SyntheticSnapshot(documents, [[1, 0]] * 240 + [[0, 1]])
        ranker = HybridRanker(snapshot)
        pool, _ = ranker._popularity(set(snapshot.recipe_ids))
        self.assertIn("dessert", pool)
        self.assertEqual(MAX_POOL, len(pool))

    def test_metric_functions_reward_correct_order_without_duplicate_credit(self):
        qrels = {"best": 3, "relevant": 2}
        self.assertEqual(1.0, recall_at_k(["best", "relevant"], qrels, 2))
        self.assertEqual(1.0, ndcg_at_k(["best", "relevant"], qrels, 2))
        self.assertEqual(0.5, recall_at_k(["best", "best"], qrels, 2))
        self.assertLess(ndcg_at_k(["best", "best"], qrels, 2), 1.0)
        self.assertLess(ndcg_at_k(["relevant", "best"], qrels, 2), 1.0)
        self.assertEqual(0.0, ndcg_at_k(["best"], {}, 2))

    def test_no_valid_interests_is_a_true_cold_start_even_if_input_ids_were_supplied(self):
        snapshot = two_interest_snapshot()
        result = HybridRanker(snapshot).rank_for_user(["missing-private"], ["another-account"], snapshot.recipe_ids)
        self.assertFalse(result.metadata["personalized"])
        self.assertEqual("cold_start", result.metadata["mode"])

    def test_context_reranks_only_using_available_metadata(self):
        snapshot = SyntheticSnapshot([
            document("seed", "Dinner"),
            document("a-unknown", "Dinner A", minutes=0),
            document("b-matching", "Dinner B", ingredients=("mushroom",), cuisines=("thai",),
                     diets=("vegetarian",), minutes=15)], [[1, 0], [1, 0], [1, 0]])
        options = {"ingredients": ["mushroom"], "availableIngredients": ["mushroom"],
                   "cuisines": ["thai"], "dietaryPreferences": ["vegetarian"], "maxCookingTime": 20}
        result = HybridRanker(snapshot, diversity_lambda=1).recommend_by_id("seed", snapshot.recipe_ids, preferences=options)
        self.assertEqual("b-matching", result[0][0])
        self.assertEqual(0, HybridRanker(snapshot)._context("a-unknown", options))

    def test_repeated_requests_are_deterministic_and_do_not_retain_a_user_profile(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot)
        before = set(ranker.__dict__)
        a = ranker.recommend_for_user(["seed-savory"], [], snapshot.recipe_ids)
        ranker.recommend_for_user(["seed-sweet"], [], snapshot.recipe_ids)
        b = ranker.recommend_for_user(["seed-savory"], [], reversed(snapshot.recipe_ids))
        self.assertEqual(a, b)
        self.assertEqual(before, set(ranker.__dict__))
        self.assertTrue(all(isinstance(recipe_id, str) and math.isfinite(score) for recipe_id, score in a))

    def test_interest_bound_does_not_allow_seen_recipes_back_into_results(self):
        documents = [document(f"seen-{index}", "Mushroom") for index in range(25)] + [document("new", "Mushroom rice")]
        snapshot = SyntheticSnapshot(documents, [[1, 0]] * len(documents))
        result = HybridRanker(snapshot).rank_for_user(snapshot.recipe_ids[:-1], [], snapshot.recipe_ids)
        self.assertLessEqual(result.metadata["interestsUsed"], 12)
        self.assertEqual(["new"], [recipe_id for recipe_id, _ in result.recommendations])

    def test_empty_candidates_zero_count_and_invalid_options_fail_safely(self):
        snapshot = two_interest_snapshot()
        ranker = HybridRanker(snapshot)
        self.assertEqual([], ranker.recommend_for_user([], [], []))
        self.assertEqual([], ranker.recommend_by_id("seed-savory", snapshot.recipe_ids, top_k=0))
        for options in ({"top_k": -1}, {"top_k": 101}, {"fav_weight": float("nan")}, {"hist_weight": -1}):
            with self.assertRaises(ValueError):
                ranker.recommend_for_user([], [], snapshot.recipe_ids, **options)
        with self.assertRaises(ValueError):
            ranker.recommend_for_user([], [], None)
        with self.assertRaises(ValueError):
            ranker.rank_query("mushroom", [float("nan"), 0, 0], snapshot.recipe_ids)


if __name__ == "__main__":
    unittest.main()
