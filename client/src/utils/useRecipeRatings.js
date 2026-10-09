import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { recipeRatingIds, RATING_BATCH_SIZE } from './recipeReads';
import { recipeReadClient } from './recipeReadClient';

export function useRecipeRatings(recipes, enabled = true) {
  const { user, loading: authLoading } = useAuth();
  const idsKey = recipeRatingIds(recipes).join(',');
  const userId = user?.id || null;
  const identity = `${userId || 'guest'}:${idsKey}`;
  const [state, setState] = useState({ identity: '', ratings: {} });
  useEffect(() => {
    if (!enabled || authLoading || !idsKey) return;
    const controller = new AbortController();
    const ids = idsKey.split(',');
    const load = async () => {
      const ratings = {};
      try {
        for (let start = 0; start < ids.length; start += RATING_BATCH_SIZE) {
          Object.assign(ratings, await recipeReadClient.ratings(ids.slice(start, start + RATING_BATCH_SIZE),
            { signal: controller.signal, userId }));
        }
        if (!controller.signal.aborted) setState({ identity, ratings });
      } catch {
        // The catalog's stored overall aggregate remains usable during an outage.
        if (!controller.signal.aborted) setState({ identity, ratings: {} });
      }
    };
    load();
    return () => controller.abort();
  }, [idsKey, identity, userId, enabled, authLoading]);
  return enabled && !authLoading && state.identity === identity ? state.ratings : {};
}
