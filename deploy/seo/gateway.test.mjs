import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymousCatalog, recipeSitemap, renderDocument, resolveRequest, robotsText, sitemapIndex } from './gateway.mjs';
import { routeMetadata, seoConfig } from '../../client/src/utils/seo.js';

const config = seoConfig({ publicSiteOrigin: 'https://meals.example.org', indexingEnabled: true });
const id = '12345678-1234-1234-1234-123456789abc';
const recipe = { id, public: true, title: 'Rice dinner', description: 'A rice dinner.', imageKind: 'source', imageUrl: `/recipe-images/${id}.jpg`, directions: 'Cook rice.\nServe.', ingredients: [{ ingredientName: 'rice', quantity: '100', unit: 'g' }] };
const template = '<!doctype html><html lang="en"><head><title>Old title</title><meta name="description" content="Old"><meta name="robots" content="noindex"><meta property="og:title" content="Old"><meta name="theme-color" content="#FED369"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const catalog = { recipe: async () => recipe, page: async (number = 0) => ({ content: [recipe], totalElements: 10000, number, last: number >= 1 }) };
const resolve = (path, changes = {}) => resolveRequest(path, { template, config, catalog, ...changes });

test('every visitor receives the same initial public recipe content and metadata', async () => {
  const response = await resolve(`/recipes/${id}`); assert.equal(response.status, 200); assert.match(response.body, /<h1>Rice dinner<\/h1>/); assert.match(response.body, /100 g rice/); assert.match(response.body, /HowToStep/); assert.equal((response.body.match(/<title\b/g) || []).length, 1); assert.equal((response.body.match(/name="robots"/g) || []).length, 1); assert.equal((response.body.match(/rel="canonical"/g) || []).length, 1); assert.match(response.headers['X-Robots-Tag'], /^index/);
  assert.ok(!response.body.includes('Old title')); assert.match(response.body, /theme-color/); assert.match(response.body, /assets\/app.js/);
});
test('anonymous missing/private recipes return generic real404 with no private snapshot', async () => {
  for (const value of [async () => { throw Object.assign(new Error(), { status: 404 }); }, async () => ({ ...recipe, public: false, title: 'Private family recipe' })]) {
    const response = await resolve(`/recipes/${id}`, { catalog: { ...catalog, recipe: value } }); assert.equal(response.status, 404); assert.match(response.headers['X-Robots-Tag'], /noindex/); assert.ok(!response.body.includes('Private family recipe')); assert.ok(!response.body.includes('application/ld+json')); assert.ok(!response.body.includes('rel="canonical"'));
  }
});
test('recipe upstream outages are503, noindex and never a cached recipe', async () => { const response = await resolve(`/recipes/${id}`, { catalog: { ...catalog, recipe: async () => { throw new Error('Unavailable'); } } }); assert.equal(response.status, 503); assert.equal(response.headers['Retry-After'], '60'); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.match(response.headers['X-Robots-Tag'], /noindex/); assert.ok(!response.body.includes(recipe.title)); });
test('unknown routes404 and private routes200 without querying owner data', async () => {
  const never = { recipe: () => { throw new Error('must not fetch'); }, page: () => { throw new Error('must not fetch'); } };
  assert.equal((await resolve('/not-a-route', { catalog: never })).status, 404);
  const response = await resolve('/profile?token=private-secret', { catalog: never }); assert.equal(response.status, 200); assert.match(response.headers['X-Robots-Tag'], /noindex/); assert.ok(!response.body.includes('private-secret'));
});
test('marketing pages render and enter the public sitemap without querying kitchen data', async () => {
  const never = { recipe: () => { throw new Error('must not fetch'); }, page: () => { throw new Error('must not fetch'); } };
  const sitemap = await resolve('/sitemaps/pages.xml', { catalog: never });
  for (const pathname of ['/features', '/how-it-works']) {
    const meta = routeMetadata({ pathname, config });
    const response = await resolve(pathname, { catalog: never });
    assert.equal(response.status, 200); assert.match(response.headers['X-Robots-Tag'], /^index/);
    assert.ok(response.body.includes(`<h1>${meta.title.replace(/ \| Let Me Cook$/, '')}</h1>`));
    assert.ok(response.body.includes(`href="${config.origin + pathname}"`));
    assert.ok(sitemap.body.includes(`<loc>${config.origin + pathname}</loc>`));
    const local = await resolve(pathname, { config: seoConfig(), catalog: never });
    assert.equal(local.status, 200); assert.match(local.headers['X-Robots-Tag'], /noindex/); assert.ok(!local.body.includes('rel="canonical"'));
    const query = await resolve(`${pathname}?kitchen=private-secret`, { catalog: never });
    assert.equal(query.status, 200); assert.match(query.headers['X-Robots-Tag'], /noindex/); assert.ok(!query.body.includes('private-secret'));
    const slash = await resolve(pathname + '/', { catalog: never });
    assert.equal(slash.status, 301); assert.equal(slash.headers.Location, pathname);
  }
  for (const pathname of ['/sunny', '/meal-planner', '/pantry', '/profile', '/household']) assert.ok(!sitemap.body.includes(`<loc>${config.origin + pathname}</loc>`));
});
test('local sitemap/robots never invent domains or query the database', async () => {
  const never = { page: () => { throw new Error('must not fetch'); } };
  for (const path of ['/sitemap.xml', '/sitemaps/recipes-1.xml', '/robots.txt']) { const response = await resolve(path, { config: seoConfig(), catalog: never }); assert.equal(response.status, 200); assert.ok(!response.body.includes('https://')); assert.ok(!response.body.includes('<loc>')); }
  assert.ok(!robotsText(seoConfig()).includes('Sitemap:'));
});
test('10000 public records produce20 bounded sitemap chunks, not one giant file', () => { const index = sitemapIndex(10000, config); assert.equal((index.match(/<sitemap>/g) || []).length, 21); assert.match(index, /recipes-20.xml/); assert.ok(!index.includes('recipes-21.xml')); });
test('sitemap uses current anonymous visibility and stable original source images only', () => {
  const upload = { ...recipe, id: '22345678-1234-1234-1234-123456789abc', imageKind: 'upload', imageUrl: '/storage/photo?token=secret' };
  const privateRecipe = { ...recipe, id: '32345678-1234-1234-1234-123456789abc', public: false, title: 'Private' };
  const result = recipeSitemap([recipe, upload, privateRecipe], config); assert.equal((result.match(/<url>/g) || []).length, 2); assert.equal((result.match(/<image:image>/g) || []).length, 1); assert.ok(!result.includes(privateRecipe.id)); assert.ok(!result.includes('token=secret'));
});
test('sitemap upstream failure is503 and contains no stale URLs', async () => { const response = await resolve('/sitemap.xml', { catalog: { page: async () => { throw new Error('offline'); } } }); assert.equal(response.status, 503); assert.ok(!response.body.includes('<loc>')); });
test('catalog fallback keeps public links and uses the client default ordering', async () => {
  const calls = []; const response = await resolve('/recipes', { catalog: { ...catalog, page: async (...args) => { calls.push(args); return { content: [recipe], number: 0, last: false }; } } });
  assert.deepEqual(calls, [[0, 24, 'createdAt,desc']]); assert.match(response.body, new RegExp(`/recipes/${id}`)); assert.match(response.body, /recipes\?page=1/);
  const failure = await resolve('/recipes', { catalog: { ...catalog, page: async () => { throw new Error(); } } }); assert.equal(failure.status, 200); assert.match(failure.headers['X-Robots-Tag'], /noindex/);
});
test('anonymous transport never forwards cookies, JWTs or external source URLs', async () => {
  let call; const api = anonymousCatalog({ fetchImpl: async (...args) => { call = args; return new Response(JSON.stringify(recipe), { headers: { 'Content-Type': 'application/json' } }); } });
  await api.recipe(id); assert.equal(call[0], `http://127.0.0.1:9402/api/recipes/${id}`); assert.equal(call[1].credentials, 'omit'); assert.deepEqual(call[1].headers, { Accept: 'application/json' }); assert.equal(call[1].redirect, 'error');
  await api.page(0); assert.equal(call[0], 'http://127.0.0.1:9402/api/recipes?page=0&size=500&sort=title,asc&sort=id,asc');
  assert.throws(() => anonymousCatalog({ base: 'https://external.example.org' }));
});
test('initial JSON config agrees with head metadata without a second recipe schema tag', () => {
  const meta = routeMetadata({ pathname: `/recipes/${id}`, recipe, publicVerified: true, config }); const document = renderDocument(template, meta, { recipe, config });
  const bootstrap = JSON.parse(/<script id="lmc-seo-config" type="application\/json">([^]*?)<\/script>/.exec(document)[1]);
  assert.equal(bootstrap.metadata.title, meta.title); assert.equal(bootstrap.metadata.canonical, meta.canonical); assert.equal(bootstrap.indexingEnabled, true); assert.equal((document.match(/type="application\/ld\+json"/g) || []).length, 1);
});
test('known trailing slash and recipe UUID case aliases redirect to the canonical path', async () => {
  const slash = await resolve('/about/'); assert.equal(slash.status, 301); assert.equal(slash.headers.Location, '/about');
  const upper = await resolve(`/recipes/${id.toUpperCase()}`); assert.equal(upper.status, 301); assert.equal(upper.headers.Location, `/recipes/${id}`);
});
