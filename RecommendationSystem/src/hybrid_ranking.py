"""Local hybrid retrieval, bounded reranking and diverse recipe recommendations.

Every request requires fresh authoritative eligible IDs. Only public catalog
features are retained on the ranker; user interests/results are request-local.
BM25 handles lexical evidence, multilingual embeddings handle semantic evidence,
weighted RRF combines separate interests, and MMR reduces near-duplicates.
Scores are deterministic heuristic relevance values, never probabilities.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
import math
import re
from typing import Mapping
import unicodedata

import numpy as np


VERSION = "hybrid-rrf-mmr-v1"
MAX_POOL = 200
MAX_INTERESTS = 12
MAX_QUERY_TERMS = 64
_STOPWORDS = frozenset("a an the and or of to in for with on at from by is are as this that recipe recipes cook cooking make serve tablespoon tablespoons teaspoon teaspoons tbsp tsp cup cups gram grams ml g".split())


def _text(value):
    return value if isinstance(value, str) else ""


def _terms(value):
    folded = unicodedata.normalize("NFKD", _text(value).casefold())
    folded = "".join(character for character in folded if not unicodedata.combining(character))
    return [word for word in re.findall(r"[^\W_]+", folded, flags=re.UNICODE)
            if len(word) > 1 and not word.isdigit() and word not in _STOPWORDS]


def _values(value):
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple)):
        return [item for item in value if isinstance(item, str) and item.strip()]
    return []


def _number(value, default=0.0):
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return result if math.isfinite(result) else default


def _ids(values):
    if values is None:
        return []
    if isinstance(values, (str, bytes, Mapping)):
        raise ValueError("Recipe IDs must be a collection of strings")
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value))


def _unit_vector(value, dimension):
    vector = np.asarray(value, dtype=np.float32)
    if vector.ndim != 1 or len(vector) != dimension or not np.isfinite(vector).all():
        raise ValueError("Query vector does not match the public embedding index")
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else None


def _requested_terms(preferences, field):
    return [frozenset(_terms(value)) for value in _values(preferences.get(field)) if _terms(value)]


def _coverage(requested, actual):
    if not requested:
        return 0.0
    return sum(any(term <= value for value in actual) for term in requested) / len(requested)


@dataclass(frozen=True)
class RankingResult:
    recommendations: tuple
    metadata: Mapping


class HybridRanker:
    """Consume the immutable HybridSnapshot contract without a user-result cache."""

    def __init__(self, snapshot, *, dense_weight=0.5, rrf_k=60, diversity_lambda=0.78):
        self.snapshot = snapshot
        self.recipe_ids = tuple(snapshot.recipe_ids)
        self.id_to_row = snapshot.id_to_row
        self.embeddings = np.asarray(snapshot.embeddings, dtype=np.float32)
        if (len(set(self.recipe_ids)) != len(self.recipe_ids)
                or self.embeddings.ndim != 2
                or len(self.embeddings) != len(self.recipe_ids)
                or not np.isfinite(self.embeddings).all()):
            raise ValueError("Public index IDs and vectors must be aligned and finite")
        if set(snapshot.documents) != set(self.recipe_ids):
            raise ValueError("Public index documents must match its vector IDs")
        if any(self.id_to_row.get(recipe_id) != row for row, recipe_id in enumerate(self.recipe_ids)):
            raise ValueError("Public index ID positions must match its vectors")
        self.dense_weight = float(dense_weight)
        self.rrf_k = int(rrf_k)
        self.diversity_lambda = float(diversity_lambda)
        if (not math.isfinite(self.dense_weight) or not 0 <= self.dense_weight <= 1
                or self.rrf_k < 1 or not math.isfinite(self.diversity_lambda)
                or not 0 <= self.diversity_lambda <= 1):
            raise ValueError("Invalid hybrid ranking parameters")
        self._public_ids = frozenset(self.recipe_ids)
        self._lengths = np.zeros(len(self.recipe_ids), dtype=np.float32)
        postings = defaultdict(list)
        self._ingredient_terms = {}
        self._tags = {}
        for row, recipe_id in enumerate(self.recipe_ids):
            document = snapshot.documents[recipe_id]
            body = document.get("text") or " ".join([
                _text(document.get("title")), _text(document.get("description")),
                " ".join(_values(document.get("ingredients"))),
                " ".join(_values(document.get("cuisines"))),
                " ".join(_values(document.get("categories"))),
                " ".join(_values(document.get("dietaryPreferences"))),
            ])
            frequencies = Counter(_terms(body))
            self._lengths[row] = sum(frequencies.values())
            for term, count in frequencies.items():
                postings[term].append((row, count))
            self._ingredient_terms[recipe_id] = tuple(frozenset(_terms(value)) for value in _values(document.get("ingredients")))
            self._tags[recipe_id] = frozenset(
                " ".join(_terms(value)) for field in ("cuisines", "categories")
                for value in _values(document.get(field)) if _terms(value))
        self._postings = {
            term: (np.asarray([row for row, _ in entries], dtype=np.int32),
                   np.asarray([count for _, count in entries], dtype=np.float32))
            for term, entries in postings.items()
        }

    def _allowed(self, eligible_ids, excluded_ids):
        if eligible_ids is None:
            raise ValueError("Fresh authoritative eligible IDs are required")
        return (set(_ids(eligible_ids)) & self._public_ids) - set(_ids(excluded_ids))

    def _sparse(self, query, allowed, limit=MAX_POOL):
        """Score only eligible postings; revoked rows cannot affect IDF/lengths."""
        if not allowed:
            return []
        mask = np.zeros(len(self.recipe_ids), dtype=bool)
        rows = np.fromiter((self.id_to_row[recipe_id] for recipe_id in allowed), dtype=np.int32)
        mask[rows] = True
        average_length = max(float(self._lengths[rows].mean()), 1.0)
        count = len(rows)
        scores = np.zeros(len(self.recipe_ids), dtype=np.float64)
        for term in list(dict.fromkeys(_terms(query)))[:MAX_QUERY_TERMS]:
            posting = self._postings.get(term)
            if posting is None:
                continue
            positions, frequencies = posting
            eligible = mask[positions]
            positions, frequencies = positions[eligible], frequencies[eligible]
            if not len(positions):
                continue
            idf = math.log1p((count - len(positions) + 0.5) / (len(positions) + 0.5))
            denominator = frequencies + 1.2 * (0.25 + 0.75 * self._lengths[positions] / average_length)
            scores[positions] += idf * frequencies * 2.2 / denominator
        matching = [row for row in rows if scores[row] > 0]
        matching.sort(key=lambda row: (-scores[row], self.recipe_ids[row]))
        return [(self.recipe_ids[row], float(scores[row])) for row in matching[:limit]]

    def _dense(self, vector, allowed):
        normalized = _unit_vector(vector, self.embeddings.shape[1])
        if normalized is None or not allowed or self.dense_weight == 0:
            return []
        # The snapshot masks before dot/top-k; this guard also rejects bad outputs.
        return [(recipe_id, float(score))
                for recipe_id, score in self.snapshot.dense_search(normalized, allowed, limit=MAX_POOL)
                if recipe_id in allowed and math.isfinite(float(score)) and score > 0]

    def _seed_query(self, recipe_id):
        document = self.snapshot.documents[recipe_id]
        return " ".join([_text(document.get("title")),
                         " ".join(_values(document.get("ingredients"))),
                         " ".join(_values(document.get("cuisines")))])

    def _fusion(self, interests, allowed):
        fused = defaultdict(float)
        counts = {"dense": 0, "sparse": 0}
        for query, vector, weight in interests:
            from src.request_context import checkpoint
            checkpoint()
            channels = []
            if self.dense_weight > 0:
                channels.append(("dense", self._dense(vector, allowed), self.dense_weight))
            if self.dense_weight < 1:
                channels.append(("sparse", self._sparse(query, allowed), 1 - self.dense_weight))
            for name, ranking, channel_weight in channels:
                counts[name] += len(ranking)
                for rank, (recipe_id, _) in enumerate(ranking, start=1):
                    fused[recipe_id] += weight * channel_weight / (self.rrf_k + rank)
        # Retrieval considers every allowed document; only reranking is bounded.
        pool = sorted(fused, key=lambda recipe_id: (-fused[recipe_id], recipe_id))[:MAX_POOL]
        maximum = max(fused.values(), default=1.0)
        return pool, {recipe_id: fused[recipe_id] / maximum for recipe_id in pool}, counts

    def _popularity(self, allowed):
        raw_views = {}
        raw_ratings = {}
        for recipe_id in allowed:
            document = self.snapshot.documents[recipe_id]
            views = max(0, _number(document.get("viewCount")))
            rating_count = max(0, _number(document.get("ratingCount")))
            average = _number(document.get("ratingAverage"))
            raw_views[recipe_id] = math.log1p(views)
            raw_ratings[recipe_id] = (average / 5 * rating_count / (rating_count + 10)
                                     if rating_count > 0 and 1 <= average <= 5 else 0)
        maximum = max(raw_views.values(), default=0)
        scores = {recipe_id: 0.7 * (raw_views[recipe_id] / maximum if maximum else 0)
                  + 0.3 * raw_ratings[recipe_id] for recipe_id in allowed}
        ordered = sorted(allowed, key=lambda recipe_id: (-scores[recipe_id], recipe_id))
        if len(ordered) <= MAX_POOL:
            return ordered, scores
        # Mix real popularity with source category/cuisine coverage before MMR.
        selected = ordered[:160]
        seen = set(selected)
        covered = set().union(*(self._tags[recipe_id] for recipe_id in selected))
        for recipe_id in ordered[160:]:
            if self._tags[recipe_id] - covered:
                selected.append(recipe_id)
                seen.add(recipe_id)
                covered.update(self._tags[recipe_id])
                if len(selected) == MAX_POOL:
                    break
        for recipe_id in ordered:
            if len(selected) == MAX_POOL:
                break
            if recipe_id not in seen:
                selected.append(recipe_id)
                seen.add(recipe_id)
        return selected, {recipe_id: scores[recipe_id] for recipe_id in selected}

    def _context(self, recipe_id, preferences):
        document = self.snapshot.documents[recipe_id]
        ingredients = _coverage(_requested_terms(preferences, "ingredients"), self._ingredient_terms[recipe_id])
        available = _coverage(_requested_terms(preferences, "availableIngredients"), self._ingredient_terms[recipe_id])
        cuisine = _coverage(_requested_terms(preferences, "cuisines"),
                            [frozenset(_terms(value)) for value in _values(document.get("cuisines"))])
        diets = _coverage(_requested_terms(preferences, "dietaryPreferences"),
                         [frozenset(_terms(value)) for value in _values(document.get("dietaryPreferences"))])
        maximum = _number(preferences.get("maxCookingTime"))
        cooking_time = _number(document.get("cookingTime"))
        time_match = 1.0 if maximum > 0 and 0 < cooking_time <= maximum else 0.0
        preferred=_coverage(_requested_terms(preferences,'preferredIngredients'),self._ingredient_terms[recipe_id])
        avoided=_coverage(_requested_terms(preferences,'avoidedIngredients'),self._ingredient_terms[recipe_id])
        preferred_cuisine=_coverage(_requested_terms(preferences,'preferredCuisines'),[frozenset(_terms(value)) for value in _values(document.get('cuisines'))])
        feedback=preferences.get('tasteFeedback',())
        weighted=0.0
        count=0
        for item in feedback:
            seed=item.get('recipeId')
            if seed not in self.id_to_row:continue
            rating=_number(item.get('rating'),3)
            if not 1<=rating<=5:continue
            similarity=max(0,float(self.embeddings[self.id_to_row[recipe_id]]@self.embeddings[self.id_to_row[seed]]))
            weighted+=((rating-3)/2)*similarity
            count+=1
        return (0.10 * ingredients + 0.06 * available + 0.05 * cuisine + 0.05 * diets + 0.04 * time_match
                +.10*preferred-.12*avoided+.06*preferred_cuisine+.14*(weighted/count if count else 0))

    def context_score(self,recipe_id,preferences):
        """Soft public-source feature score after caller authorization."""
        if recipe_id not in self.id_to_row:return 0.0
        return self._context(recipe_id,preferences)

    def _diverse(self, pool, relevance, top_k):
        if not pool or top_k == 0:
            return []
        positions = [self.id_to_row[recipe_id] for recipe_id in pool]
        vectors = self.embeddings[positions]
        similarities = np.clip(vectors @ vectors.T, 0, 1)
        # Exact ingredient overlap detects lexical near-duplicates too.
        ingredient_sets = [set().union(*self._ingredient_terms[recipe_id]) for recipe_id in pool]
        for first in range(len(pool)):
            from src.request_context import checkpoint
            checkpoint()
            for second in range(first + 1, len(pool)):
                union = ingredient_sets[first] | ingredient_sets[second]
                overlap = len(ingredient_sets[first] & ingredient_sets[second]) / len(union) if union else 0
                similarities[first, second] = similarities[second, first] = max(similarities[first, second], overlap)
        selected = []
        remaining = set(range(len(pool)))
        while remaining and len(selected) < top_k:
            from src.request_context import checkpoint
            checkpoint()
            def utility(position):
                redundancy = max((float(similarities[position, previous]) for previous in selected), default=0.0)
                return self.diversity_lambda * relevance[pool[position]] - (1 - self.diversity_lambda) * redundancy
            best = min(remaining, key=lambda position: (-utility(position), -relevance[pool[position]], pool[position]))
            selected.append(best)
            remaining.remove(best)
        return [(pool[position], float(relevance[pool[position]])) for position in selected]

    def _finish(self, allowed, interests, top_k, preferences, mode):
        if isinstance(top_k, bool) or not isinstance(top_k, int) or not 0 <= top_k <= 100:
            raise ValueError("top_k must be an integer between 0 and 100")
        if preferences is not None and not isinstance(preferences, Mapping):
            raise ValueError("Preferences must be an object")
        if not allowed or top_k == 0:
            return RankingResult((), {"version": VERSION, "mode": mode, "personalized": False,
                                      "eligibleCandidates": len(allowed), "candidatePoolSize": 0,
                                      "interestsUsed": len(interests), "retrievalEvidence": {"dense": 0, "sparse": 0},
                                      "rerankLimit": MAX_POOL, "scoreType": "heuristic_relevance_not_probability",
                                      "methods": []})
        if interests:
            pool, retrieval, counts = self._fusion(interests, allowed)
        else:
            pool, retrieval, counts = [], {}, {"dense": 0, "sparse": 0}
        personalized = bool(pool) and mode == "personalized"
        methods = [name for channel, name in (("dense", "local_dense_embedding"), ("sparse", "BM25"))
                   if counts[channel] > 0]
        if not pool:
            pool, retrieval = self._popularity(allowed)
            mode = "cold_start" if not interests else "catalog_fallback"
            methods = ["source_popularity"]
        else:
            methods.append("weighted_RRF")
        preferences = preferences or {}
        relevance = {recipe_id: max(0,min(1.0, .15 + 0.55 * retrieval[recipe_id] + self._context(recipe_id, preferences)))
                     for recipe_id in pool}
        recommendations = self._diverse(pool, relevance, top_k)
        metadata = {"version": VERSION, "mode": mode, "personalized": personalized,
                    "eligibleCandidates": len(allowed), "candidatePoolSize": len(pool),
                    "interestsUsed": len(interests), "retrievalEvidence": counts,
                    "rerankLimit": MAX_POOL, "scoreType": "heuristic_relevance_not_probability",
                    "methods": methods + ["bounded_context_rerank", "MMR"]}
        return RankingResult(tuple(recommendations), metadata)

    def rank_for_user(self, fav_ids, hist_ids, eligible_ids, *, excluded_ids=(), visible_seed_ids=None,
                      preferences=None, top_k=10, fav_weight=2.0, hist_weight=1.0):
        """Candidate eligibility and seed visibility are fresh independent masks.

        Servers often remove previously seen IDs from candidate eligibility.
        They must separately authorize those public seed IDs through
        visible_seed_ids; candidate exclusions include these seen IDs, so they
        do not revoke explicitly authorized seeds. The caller must remove
        disliked interests before supplying favorites/history. Omitting a
        separate seed mask fails closed to the candidate mask.
        """
        for value in (fav_weight, hist_weight):
            if not math.isfinite(float(value)) or float(value) <= 0:
                raise ValueError("Interest weights must be positive and finite")
        excluded = _ids(excluded_ids)
        allowed = self._allowed(eligible_ids, excluded)
        seed_public = allowed if visible_seed_ids is None else self._allowed(visible_seed_ids, ())
        favorite_input, history_input = _ids(fav_ids), _ids(hist_ids)
        favorites = [recipe_id for recipe_id in favorite_input if recipe_id in seed_public]
        favorite_set = set(favorites)
        history = [recipe_id for recipe_id in history_input if recipe_id in seed_public and recipe_id not in favorite_set]
        allowed = allowed - set(favorite_input) - set(history_input)
        selected_favorites = favorites[:8]
        selected_history = history[:MAX_INTERESTS - len(selected_favorites)]
        if not selected_history:
            selected_favorites = favorites[:MAX_INTERESTS]
        interests = []
        for seeds, weight in ((selected_favorites, float(fav_weight)), (selected_history, float(hist_weight))):
            for recipe_id in seeds:
                vector = self.embeddings[self.id_to_row[recipe_id]]
                interests.append((self._seed_query(recipe_id), vector, weight / len(seeds)))
        preferences=dict(preferences or {})
        feedback=[item for item in preferences.get('tasteFeedback',()) if item.get('recipeId') in seed_public]
        preferences['tasteFeedback']=feedback
        positive=[item for item in feedback if _number(item.get('rating'))>3 and item['recipeId'] not in favorite_set][:max(0,MAX_INTERESTS-len(interests))]
        for item in positive:
            recipe_id=item['recipeId']
            interests.append((self._seed_query(recipe_id),self.embeddings[self.id_to_row[recipe_id]],(_number(item['rating'])-3)/2))
        query=' '.join(_values(preferences.get('preferredIngredients'))+_values(preferences.get('preferredCuisines')))
        if query and len(interests)<MAX_INTERESTS:
            interests.append((query,np.zeros(self.embeddings.shape[1],dtype=np.float32),.5))
        return self._finish(allowed, interests, top_k, preferences, "personalized" if interests else "cold_start")

    def recommend_for_user(self, fav_ids, hist_ids, eligible_ids, **options):
        return list(self.rank_for_user(fav_ids, hist_ids, eligible_ids, **options).recommendations)

    def rank_by_id(self, target_id, eligible_ids, *, excluded_ids=(), preferences=None, top_k=10):
        public = self._allowed(eligible_ids, excluded_ids)
        if target_id not in public:
            raise ValueError("Recipe is not available in the public catalog")
        vector = self.embeddings[self.id_to_row[target_id]]
        interests = [(self._seed_query(target_id), vector, 1.0)]
        return self._finish(public - {target_id}, interests, top_k, preferences, "recipe_similarity")

    def recommend_by_id(self, target_id, eligible_ids, **options):
        return list(self.rank_by_id(target_id, eligible_ids, **options).recommendations)

    def rank_query(self, query, query_vector, eligible_ids, *, excluded_ids=(), preferences=None, top_k=10):
        """The caller embeds free text locally using the snapshot's pinned encoder."""
        if not isinstance(query, str) or len(query) > 2000:
            raise ValueError("Query must contain at most 2000 characters")
        interests = [(query, query_vector, 1.0)] if query.strip() else []
        return self._finish(self._allowed(eligible_ids, excluded_ids), interests, top_k, preferences, "query")
