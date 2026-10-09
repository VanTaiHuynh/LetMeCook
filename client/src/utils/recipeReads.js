import { requestFailure } from './requestFailure.js';
import { createHttpTransport } from './httpTransport.js';

export const RATING_BATCH_SIZE = 100;
export const REVIEW_PAGE_SIZE = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aborted = signal => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
const invalid = () => requestFailure(undefined, 'Recipe data could not be loaded. Try again.');

export function recipeRatingIds(recipes = []) {
  return [...new Set(recipes.map(recipe => recipe.id).filter(id => typeof id === 'string' && UUID.test(id)))].sort();
}

export function createRecipeReadClient({ baseUrl = '/api', getSession, fetcher = fetch, timeoutMs = 30000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid request timeout');
  const transport = createHttpTransport({ baseUrl, getSession, fetcher, defaultTimeoutMs: timeoutMs });
  const request = (path, { userId, ...options } = {}) => transport.json(path, { ...options, actorId: userId, service: 'Recipes', unreadableMessage: 'Recipe data could not be loaded. Try again.' });
  return {
    async detail(id, options) {
      if (!UUID.test(id)) throw requestFailure(404);
      const body = await request(`recipes/${id}`, options);
      if (typeof body.id !== 'string' || body.id.toLowerCase() !== id.toLowerCase()
          || typeof body.title !== 'string' || !Array.isArray(body.ingredients)) throw invalid();
      return body;
    },
    async ratings(ids, options) {
      const unique = [...new Set(ids)];
      if (!unique.length) return {};
      if (unique.length > RATING_BATCH_SIZE || unique.some(id => !UUID.test(id))) throw invalid();
      const body = await request(`recipes/feedback/ratings?ids=${encodeURIComponent(unique.join(','))}`, options);
      if (!body.ratings || Array.isArray(body.ratings) || typeof body.ratings !== 'object') throw invalid();
      // Never let a malformed aggregate response hydrate a recipe outside this group.
      const entries = unique.filter(id => Object.hasOwn(body.ratings, id)).map(id => [id, body.ratings[id]]);
      for (const [, summary] of entries) {
        if (!summary || !Number.isInteger(summary.overallCount) || summary.overallCount < 0
            || !['cost', 'time', 'difficulty', 'overall'].every(category => summary[category] === null
              || (typeof summary[category] === 'number' && Number.isFinite(summary[category])
                && summary[category] >= 1 && summary[category] <= 5))
            || (summary.overallCount > 0 && summary.overall === null)
            || (summary.overallCount === 0 && summary.overall !== null)) throw invalid();
      }
      return Object.fromEntries(entries);
    },
    async reviews(id, { page = 0, sort = 'recent', order = 'desc', ...options } = {}) {
      if (!UUID.test(id) || !Number.isInteger(page) || page < 0 || page > 100000
          || !['recent', 'rating'].includes(sort) || !['asc', 'desc'].includes(order)) throw invalid();
      const params = new URLSearchParams({ page, size: REVIEW_PAGE_SIZE, sort, order });
      const body = await request(`recipes/${id}/feedback/reviews?${params}`, options);
      if (!Array.isArray(body.content) || body.content.length > REVIEW_PAGE_SIZE || body.page !== page
          || !Number.isInteger(body.totalElements) || body.totalElements < 0
          || !Number.isInteger(body.totalPages) || body.totalPages < 0) throw invalid();
      return body;
    },
  };
}

export async function recordRecipeActivity(client, recipeId, userId, signal) {
  if (signal?.aborted) return [];
  const work = [];
  if (userId) work.push(Promise.resolve().then(() => {
    aborted(signal);
    return client.from('recipe_browsing_history').upsert({ user_id: userId, recipe_id: recipeId,
      viewed_at: new Date().toISOString() }, { onConflict: 'user_id,recipe_id' }).abortSignal(signal);
  }));
  work.push(Promise.resolve().then(() => {
    aborted(signal);
    return client.rpc('increment_view_count', { recipe_id: recipeId }).abortSignal(signal);
  }));
  return Promise.allSettled(work);
}
