import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeReadClient, recipeRatingIds, recordRecipeActivity } from './recipeReads.js';
import { normalizeRatingSummary } from './recipeRatings.js';

const id = '00000000-0000-0000-0000-000000000001';
const session = userId => async () => ({ data: { session: userId ? { user: { id: userId }, access_token: 'fixture-token' } : null } });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const detail = { id, title: 'Fixture recipe', ingredients: [] };

test('24 cards request one bounded aggregate and discard unrequested recipe aggregates', async () => {
  const ids = Array.from({ length: 24 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
  let calls = 0;
  const client = createRecipeReadClient({ getSession: session(null), fetcher: async url => {
    calls++; assert.equal(new URL(url, 'https://example.test').searchParams.get('ids').split(',').length, 24);
    return response({ ratings: { [id]: { cost: 1, time: 2, difficulty: 3, overall: 5, overallCount: 1 }, extra: { overall: 5 } } });
  } });
  const result = await client.ratings(ids, { userId: null });
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(result), [id]);
  assert.deepEqual(normalizeRatingSummary(result[id]), { cost: 1, time: 2, difficulty: 3, overall: 5, overallCount: 1 });
  assert.equal(await client.ratings([], { userId: null }).then(value => Object.keys(value).length), 0);
  assert.equal(calls, 1);
});

test('unavailable aggregates do not invent rating categories or overall stars', () => {
  assert.deepEqual(normalizeRatingSummary(), { cost: null, time: null, difficulty: null, overall: null, overallCount: 0 });
  assert.deepEqual(normalizeRatingSummary({ cost: 6, time: NaN, difficulty: 0, overall: 5, overallCount: 0 }),
    { cost: null, time: null, difficulty: null, overall: null, overallCount: 0 });
  assert.deepEqual(recipeRatingIds([{ id }, { id }, { id: 'invalid' }]), [id]);
});

test('invalid aggregate response and oversized groups fail without downloading rating rows', async () => {
  let calls = 0;
  const client = createRecipeReadClient({ getSession: session(null), fetcher: async () => {
    calls++; return response({ ratings: { [id]: { cost: 1, time: 2, difficulty: 3, overall: null, overallCount: 4 } } });
  } });
  await assert.rejects(client.ratings([id]), /Recipe data could not be loaded/);
  const ids = Array.from({ length: 101 }, (_, n) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`);
  await assert.rejects(client.ratings(ids), /Recipe data could not be loaded/);
  assert.equal(calls, 1);
});

test('detail 404 stays distinct from recoverable service, network and malformed responses', async () => {
  for (const status of [404, 500, 503]) {
    const client = createRecipeReadClient({ getSession: session(null), fetcher: async () => response({}, status) });
    await assert.rejects(client.detail(id, { userId: null }), error => error.status === status);
  }
  const offline = createRecipeReadClient({ getSession: session(null), fetcher: async () => { throw new TypeError('offline'); } });
  await assert.rejects(offline.detail(id), /Connection lost/);
  const malformed = createRecipeReadClient({ getSession: session(null), fetcher: async () => response(null) });
  await assert.rejects(malformed.detail(id), /Recipe data could not be loaded/);
  const wrongRecipe = createRecipeReadClient({ getSession: session(null), fetcher: async () => response({ ...detail, id: 'other' }) });
  await assert.rejects(wrongRecipe.detail(id), /Recipe data could not be loaded/);
});

test('new account session cannot fetch or hydrate an old account request', async () => {
  let calls = 0;
  const client = createRecipeReadClient({ getSession: session('new-account'), fetcher: async () => { calls++; return response(detail); } });
  await assert.rejects(client.detail(id, { userId: 'old-account' }), error => error.status === 401);
  await assert.rejects(client.detail(id, { userId: null }), error => error.status === 401);
  assert.equal(calls, 0);
});

test('navigation cancellation while session or JSON is pending stays silent AbortError', async () => {
  const controller = new AbortController();
  let finishSession, calls = 0;
  const client = createRecipeReadClient({ getSession: () => new Promise(resolve => { finishSession = resolve; }),
    fetcher: async () => { calls++; return response(detail); } });
  const pending = client.detail(id, { userId: null, signal: controller.signal });
  controller.abort(); finishSession({ data: { session: null } });
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(calls, 0);
  const duringJSON = new AbortController();
  const late = createRecipeReadClient({ getSession: session(null), fetcher: async () => ({ ok: true, status: 200,
    json: async () => { duringJSON.abort(); return detail; } }) });
  await assert.rejects(late.detail(id, { signal: duringJSON.signal }), error => error.name === 'AbortError');
});

test('a stuck session or transport reaches a recoverable deadline without returning late content', async () => {
  let calls = 0;
  const stuckSession = createRecipeReadClient({ timeoutMs: 10, getSession: () => new Promise(() => {}),
    fetcher: async () => { calls++; return response(detail); } });
  await assert.rejects(stuckSession.detail(id), error => error.status === 504 && /took too long/.test(error.message));
  assert.equal(calls, 0);
  const stuckFetch = createRecipeReadClient({ timeoutMs: 10, getSession: session(null), fetcher: () => new Promise(() => {}) });
  await assert.rejects(stuckFetch.detail(id), error => error.status === 504);
});

test('server review ordering/page is requested instead of fetching the browser-capped corpus', async () => {
  const client = createRecipeReadClient({ getSession: session(null), fetcher: async url => {
    const params = new URL(url, 'https://example.test').searchParams;
    assert.equal(params.get('page'), '84'); assert.equal(params.get('size'), '12');
    assert.equal(params.get('sort'), 'rating'); assert.equal(params.get('order'), 'desc');
    return response({ content: [], page: 84, totalElements: 1105, totalPages: 93 });
  } });
  const result = await client.reviews(id, { page: 84, sort: 'rating', order: 'desc', userId: null });
  assert.equal(result.totalElements, 1105);
  await assert.rejects(client.reviews(id, { sort: 'rating;delete' }), /could not be loaded/);
});

test('activity failures settle independently after primary data is available; abort prevents writes', async () => {
  const client = createRecipeReadClient({ getSession: session('owner'), fetcher: async () => response(detail) });
  const recipe = await client.detail(id, { userId: 'owner' });
  assert.equal(recipe.title, detail.title);
  const activity = { from: () => ({ upsert: () => ({ abortSignal: async () => { throw new Error('history failure'); } }) }),
    rpc: () => ({ abortSignal: async () => { throw new Error('view failure'); } }) };
  const result = await recordRecipeActivity(activity, id, 'owner', new AbortController().signal);
  assert.equal(result.length, 2); assert.ok(result.every(item => item.status === 'rejected'));
  assert.equal(recipe.title, detail.title);
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await recordRecipeActivity({ from: () => assert.fail('write'), rpc: () => assert.fail('write') }, id, 'owner', controller.signal), []);
});
