"""Offline synthetic harness; not evidence of human preference/model quality.

Run from the worker root: python tests/evaluate_hybrid_ranking.py
All documents, qrels and fixed vectors are authored fixtures. The dense-only
control is a weighted centroid, not a replay of an earlier production release.
"""
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.hybrid_ranking import HybridRanker
from hybrid_fixtures import SyntheticSnapshot, document, two_interest_snapshot


def recall_at_k(ranked_ids, relevance, k):
    positives = {recipe_id for recipe_id, grade in relevance.items() if grade > 0}
    return len(set(ranked_ids[:k]) & positives) / len(positives) if positives else 0.0


def ndcg_at_k(ranked_ids, relevance, k):
    seen = set()
    actual = 0.0
    for rank, recipe_id in enumerate(ranked_ids[:k]):
        grade = 0 if recipe_id in seen else max(0, relevance.get(recipe_id, 0))
        actual += (2 ** grade - 1) / math.log2(rank + 2)
        seen.add(recipe_id)
    ideal = sum((2 ** grade - 1) / math.log2(rank + 2)
                for rank, grade in enumerate(sorted((grade for grade in relevance.values() if grade > 0), reverse=True)[:k]))
    return min(1.0, actual / ideal) if ideal else 0.0


def _centroid_control(snapshot, allowed, favorites=(), history=(), vector=None, k=2):
    public = set(allowed) & set(snapshot.recipe_ids)
    favorites = list(dict.fromkeys(recipe_id for recipe_id in favorites if recipe_id in public))
    history = list(dict.fromkeys(recipe_id for recipe_id in history if recipe_id in public and recipe_id not in favorites))
    if vector is None:
        seeds = favorites + history
        if not seeds:
            return []
        weights = np.asarray([2.0] * len(favorites) + [1.0] * len(history))
        values = snapshot.embeddings[[snapshot.id_to_row[recipe_id] for recipe_id in seeds]]
        vector = (values * weights[:, None]).sum(axis=0) / weights.sum()
    norm = float(np.linalg.norm(vector))
    vector = vector / norm if norm else np.zeros(snapshot.embeddings.shape[1])
    candidates = public - set(favorites) - set(history)
    scores = [(recipe_id, float(snapshot.embeddings[snapshot.id_to_row[recipe_id]] @ vector)) for recipe_id in candidates]
    return [recipe_id for recipe_id, _ in sorted(scores, key=lambda value: (-value[1], value[0]))[:k]]


def evaluate():
    cases = []
    lexical = SyntheticSnapshot([
        document("literal", "Mushroom rice", ingredients=("mushroom",)),
        document("semantic", "Forest grain bowl", ingredients=("shiitake",)),
        document("unrelated", "Chocolate cake")], [[0, 1], [1, 0], [0.8, 0.2]])
    cases.append({"name": "lexical_and_semantic_evidence", "snapshot": lexical,
                  "query": "mushroom", "vector": [1, 0], "qrels": {"literal": 3, "semantic": 2}})
    multilingual = SyntheticSnapshot([document("rice", "Mushroom rice"), document("cake", "Chocolate cake")], [[1, 0], [0, 1]])
    cases.append({"name": "cross_language_dense_path", "snapshot": multilingual,
                  "query": "món cơm nấm", "vector": [1, 0], "qrels": {"rice": 3}})
    cases.append({"name": "opposite_tastes_multiple_interests", "snapshot": two_interest_snapshot(),
                  "favorites": ["seed-savory", "seed-sweet"], "qrels": {"savory-a": 3, "sweet-a": 3}})
    context = SyntheticSnapshot([document("seed", "Dinner"), document("a-unknown", "Dinner A", minutes=0),
                                 document("b-match", "Dinner B", ingredients=("mushroom",), minutes=15)], [[1, 0], [1, 0], [1, 0]])
    cases.append({"name": "source_context_time_and_ingredient", "snapshot": context,
                  "favorites": ["seed"], "preferences": {"ingredients": ["mushroom"], "maxCookingTime": 20},
                  "qrels": {"b-match": 3}})
    cold = SyntheticSnapshot([document("popular", "Rice", views=100, rating=4.8, rating_count=20),
                              document("other", "Cake")], [[1, 0], [0, 1]])
    cases.append({"name": "true_cold_start", "snapshot": cold, "favorites": [], "qrels": {"popular": 3}})
    privacy = SyntheticSnapshot([document("revoked", "Mushroom", views=500), document("public", "Mushroom rice")], [[1, 0], [1, 0]])
    cases.append({"name": "permission_revocation", "snapshot": privacy, "query": "mushroom", "vector": [1, 0],
                  "allowed": ["public"], "qrels": {"public": 3}})

    rows = []
    for case in cases:
        snapshot = case["snapshot"]
        allowed = set(case.get("allowed", snapshot.recipe_ids))
        ranker = HybridRanker(snapshot)
        favorites = case.get("favorites", [])
        history = case.get("history", [])
        if "query" in case:
            result = ranker.rank_query(case["query"], case["vector"], allowed, top_k=2)
            control = _centroid_control(snapshot, allowed, vector=np.asarray(case["vector"]), k=2)
        else:
            result = ranker.rank_for_user(favorites, history, allowed, preferences=case.get("preferences"), top_k=2)
            control = _centroid_control(snapshot, allowed, favorites, history, k=2)
        ranked = [recipe_id for recipe_id, _ in result.recommendations]
        row = {"case": case["name"], "hybrid": {"ids": ranked}, "denseCentroidControl": {"ids": control},
               "permissionViolations": len(set(ranked) - allowed),
               "seenViolations": len(set(ranked) & set(favorites + history)), "mode": result.metadata["mode"]}
        for name, ids in (("hybrid", ranked), ("denseCentroidControl", control)):
            row[name]["recallAt2"] = recall_at_k(ids, case["qrels"], 2)
            row[name]["ndcgAt2"] = ndcg_at_k(ids, case["qrels"], 2)
        rows.append(row)
    means = {name: {metric: sum(row[name][metric] for row in rows) / len(rows)
                    for metric in ("recallAt2", "ndcgAt2")}
             for name in ("hybrid", "denseCentroidControl")}
    return {"sampleType": "synthetic_authored_regression_fixtures", "humanRelevanceLabels": False,
            "actualQwenEmbeddingsEvaluated": False, "caseCount": len(rows), "k": 2, "means": means,
            "cases": rows, "permissionViolations": sum(row["permissionViolations"] for row in rows),
            "seenViolations": sum(row["seenViolations"] for row in rows),
            "limits": ["No user preference, allergy safety, conversion or production model quality claim follows from these fixtures.",
                       "The English/Vietnamese case exercises the dense integration path with a fixed vector; it does not measure Qwen language understanding.",
                       "Weights and diversity lambda remain untuned defaults until a separate, rights-cleared human-labelled evaluation set exists."]}


if __name__ == "__main__":
    print(json.dumps(evaluate(), indent=2))
