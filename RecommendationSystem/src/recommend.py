# src/recommend.py (Updated version)
import torch
from torch.nn import functional as F
from typing import List, Tuple
import logging
import os
import threading

from src.cache_manager import get_cache
from src.local_ai import public_catalog_ids
from src.legacy_cache_store import CacheBusy,CacheInvalid,ModelUnavailable
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)
_ranker_lock = threading.Lock()
_ranker_generation = None
_ranker = None


def _legacy_recommend_by_id(target_id: str, top_k: int = 10) -> List[Tuple[str, float]]:
    """
    Recommend recipes based on a target recipe ID using cached embeddings

    Args:
        target_id: Target recipe ID
        top_k: Number of recommendations to return

    Returns:
        List of (recipe_id, similarity_score) tuples
    """
    cache = get_cache()
    eligible = public_catalog_ids()
    if target_id not in eligible:
        raise ValueError("Recipe is not available in the public catalog")

    try:
        recipe_ids, embeddings = cache.get_snapshot()

        # Check if target recipe exists in cache
        if target_id not in recipe_ids:
            logger.info(f"Recipe {target_id} not in cache, adding...")
            cache.add_recipe_to_cache(target_id)
            recipe_ids, embeddings = cache.get_snapshot()

        # Find target recipe index
        try:
            idx = recipe_ids.index(target_id)
        except ValueError:
            raise ValueError(f"Recipe ID '{target_id}' not found after cache update")

        # Get target vector and compute similarities
        target_vector = embeddings[idx].to("cpu")
        similarities = F.cosine_similarity(target_vector.unsqueeze(0), embeddings, dim=1)

        # Get top results (excluding the target recipe itself)
        positions=[i for i,key in enumerate(recipe_ids) if key!=target_id and key in eligible]
        candidate_scores=similarities[positions]
        top_results = torch.topk(candidate_scores, k=min(top_k,len(positions)))

        recommendations = []
        for score, i in zip(top_results.values, top_results.indices):
            rec_id = recipe_ids[positions[int(i)]]
            if rec_id != target_id and rec_id in eligible:  # Permissions are checked before ranking results escape.
                recommendations.append((rec_id, float(score)))

            if len(recommendations) >= top_k:
                break

        logger.info(f"Generated {len(recommendations)} recommendations for recipe {target_id}")
        return recommendations

    except Exception as e:
        logger.error(f"Error in recommend_by_id: {e}")
        raise


def _legacy_recommend_for_user(
        fav_ids: List[str],
        hist_ids: List[str],
        fav_weight: float = 2.0,
        hist_weight: float = 1.0,
        top_k: int = 10,
        eligible_ids=None,
        excluded_ids=()
) -> List[Tuple[str, float]]:
    """
    Recommend recipes for a user based on favorites and history using cached embeddings

    Args:
        fav_ids: List of favorite recipe IDs
        hist_ids: List of recipe IDs from user history
        fav_weight: Weight for favorite recipes
        hist_weight: Weight for history recipes
        top_k: Number of recommendations to return

    Returns:
        List of (recipe_id, similarity_score) tuples
    """
    cache = get_cache()
    public = public_catalog_ids()
    eligible = public if eligible_ids is None else public.intersection(eligible_ids)
    eligible = eligible.difference(excluded_ids)
    fav_ids = [rid for rid in fav_ids if rid in public]
    hist_ids = [rid for rid in hist_ids if rid in public]

    try:
        recipe_ids, embeddings = cache.get_snapshot()

        # Ensure all user recipes are in cache
        missing_recipes = []
        for rid in fav_ids + hist_ids:
            if rid not in recipe_ids:
                missing_recipes.append(rid)

        if missing_recipes:
            logger.info(f"Adding {len(missing_recipes)} missing recipes to cache...")
            for rid in missing_recipes:
                try:
                    cache.add_recipe_to_cache(rid)
                except (CacheBusy,CacheInvalid,ModelUnavailable,SQLAlchemyError):
                    # Dependency failures are not a successful empty profile.
                    # The Flask gateway maps busy/unavailable to429/503.
                    raise
                except Exception as e:
                    logger.warning(f"Failed to add recipe {rid} to cache: {e}")
                    continue

            # Refresh data after adding missing recipes
            recipe_ids, embeddings = cache.get_snapshot()

        # Collect vectors and weights for user profile
        vectors = []
        weights = []

        # Add favorite recipes
        for rid in fav_ids:
            if rid in recipe_ids:
                idx = recipe_ids.index(rid)
                vectors.append(embeddings[idx].to("cpu"))
                weights.append(fav_weight)

        # Add history recipes (excluding favorites to avoid double counting)
        for rid in hist_ids:
            if rid in recipe_ids and rid not in fav_ids:
                idx = recipe_ids.index(rid)
                vectors.append(embeddings[idx].to("cpu"))
                weights.append(hist_weight)

        if not vectors:
            logger.warning("No valid recipes found in user profile")
            return []

        # Create weighted user profile vector
        stacked = torch.stack(vectors).to("cpu")
        weight_tensor = torch.tensor(weights, dtype=torch.float32).unsqueeze(1).to("cpu")
        user_vector = torch.sum(stacked * weight_tensor, dim=0) / torch.sum(weight_tensor)

        # Compute similarities
        similarities = F.cosine_similarity(user_vector.unsqueeze(0), embeddings, dim=1)

        # Get top results excluding user's existing recipes
        exclude_set = set(fav_ids + hist_ids)
        positions=[i for i,key in enumerate(recipe_ids) if key not in exclude_set and key in eligible]
        top_results = torch.topk(similarities[positions], k=min(top_k,len(positions)))

        recommendations = []
        for score, idx in zip(top_results.values, top_results.indices):
            rec_id = recipe_ids[positions[int(idx)]]
            if rec_id not in exclude_set and rec_id in eligible:
                recommendations.append((rec_id, float(score)))

            if len(recommendations) >= top_k:
                break

        logger.info(f"Generated {len(recommendations)} recommendations for user")
        return recommendations

    except Exception as e:
        logger.error(f"Error in recommend_for_user: {e}")
        raise


def _get_hybrid_ranker():
    """Readers retain one validated immutable generation; never rebuild here."""
    global _ranker, _ranker_generation
    if os.getenv("RECOMMENDATION_ENGINE", "hybrid-v2") == "legacy":
        return None
    from src.hybrid_index import get_hybrid_snapshot
    from src.hybrid_ranking import HybridRanker
    snapshot = get_hybrid_snapshot()
    if snapshot is None:
        return None
    generation = snapshot.manifest["generation"]
    with _ranker_lock:
        if _ranker is None or _ranker_generation != generation:
            _ranker = HybridRanker(snapshot)
            _ranker_generation = generation
        return _ranker


def recommend_by_id(target_id: str, top_k: int = 10) -> List[Tuple[str, float]]:
    public = public_catalog_ids()
    if target_id not in public:
        raise ValueError("Recipe is not available in the public catalog")
    ranker = _get_hybrid_ranker()
    if ranker is not None and target_id in ranker.id_to_row:
        return ranker.recommend_by_id(target_id, public, top_k=top_k)
    # A newly public recipe may precede the next explicit hybrid publication.
    # Preserve existing on-demand similarity while keeping the fresh public gate.
    return _legacy_recommend_by_id(target_id, top_k)


def recommend_for_user(fav_ids, hist_ids, fav_weight=2.0, hist_weight=1.0, top_k=10,
                       eligible_ids=None, excluded_ids=(), preferences=None):
    # A cached document can become private or lose demo permission after indexing.
    # Fresh catalog visibility is intersected with the server's account-specific
    # dietary/allergy/exclusion result before any retrieval or explanation.
    public = public_catalog_ids()
    allowed = public if eligible_ids is None else public.intersection(eligible_ids)
    favorites = list(dict.fromkeys(rid for rid in fav_ids if rid in public))
    history = list(dict.fromkeys(rid for rid in hist_ids if rid in public))
    excluded = set(excluded_ids).union(favorites, history)
    allowed = allowed.difference(excluded)
    if not allowed:
        return []
    ranker = _get_hybrid_ranker()
    if ranker is not None:
        preferences=dict(preferences or {})
        preferences['tasteFeedback']=[item for item in preferences.get('tasteFeedback',[])
                                     if item.get('recipeId') in public and item.get('recipeId') not in set(excluded_ids)]
        return ranker.recommend_for_user(favorites, history, allowed, excluded_ids=excluded,
                    visible_seed_ids=public, preferences=preferences, top_k=top_k,
                    fav_weight=fav_weight, hist_weight=hist_weight)
    return _legacy_recommend_for_user(favorites, history, fav_weight, hist_weight, top_k,
                                      eligible_ids=allowed, excluded_ids=excluded)


def get_recommendation_stats() -> dict:
    """Get statistics about the recommendation system"""
    cache = get_cache()

    try:
        cache_info = cache.get_cache_info()
        recipe_ids, embeddings = cache.get_snapshot()

        from src.hybrid_index import hybrid_status
        hybrid = hybrid_status()
        return {
            "cache_info": cache_info,
            "embedding_shape": list(embeddings.shape) if embeddings.numel() > 0 else [0],
            "system_status": ("empty_cache" if not recipe_ids else "healthy" if cache_info["is_valid"] else "cache_expired"),
            "recommendation_engine": "hybrid-v2" if hybrid.get("state") == "ready" and os.getenv("RECOMMENDATION_ENGINE", "hybrid-v2") != "legacy" else "legacy-fallback",
            "hybrid_index": hybrid,
        }

    except Exception as e:
        logger.error(f"Error getting recommendation stats: {e}")
        return {
            "cache_info": {},
            "embedding_shape": [0],
            "system_status": "error",
            "error": str(e)
        }


# Legacy function for backward compatibility
def try_update_missing_embedding(recipe_id: str):
    """Legacy function - now handled by cache manager"""
    cache = get_cache()
    cache.add_recipe_to_cache(recipe_id)
