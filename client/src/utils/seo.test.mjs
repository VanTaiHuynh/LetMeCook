import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_ROUTES, freshInitialPageMetadata, freshInitialRecipeMetadata, ingredientLines, publicOrigin, renderHead, routeMetadata, safeJSON, seoConfig, sourceImageURL } from './seo.js';

const origin = 'https://meals.example.org';
const config = seoConfig({ publicSiteOrigin: origin, indexingEnabled: true });
const id = '12345678-1234-1234-1234-123456789abc';
const recipe = { id, public: true, title: 'Mushroom rice', description: '<p>A warm rice dinner.</p>', imageKind: 'source', imageUrl: `/recipe-images/${id}.jpg`, cookingTime: 30, servings: 4, ingredients: [{ ingredientName: 'rice', quantity: '200.0', unit: 'g' }, { ingredientName: 'mushrooms', quantity: '', unit: '' }], directions: '<ol><li>Cook rice.</li><li>Add mushrooms.</li></ol>', sourceUrl: 'https://www.bbcgoodfood.com/recipes/example', sourceAuthor: 'Cassie Best', sourceLicense: 'All rights reserved', ratingAverage: 0, ratingCount: 0 };
const metadata = changes => routeMetadata({ pathname: `/recipes/${id}`, recipe, publicVerified: true, config, ...changes });

test('indexing requires an explicit HTTPS origin and opt-in', () => {
  for (const value of ['', 'http://meals.example.org', 'https://localhost', 'https://localhost.', 'https://127.0.0.1', 'https://[::1]', 'https://name:secret@meals.example.org', origin + '/subpath', origin + '?x=1']) assert.equal(publicOrigin(value), '', value);
  assert.equal(seoConfig({ publicSiteOrigin: origin }).indexingEnabled, false);
  assert.equal(seoConfig({ indexingEnabled: true }).indexingEnabled, false);
  assert.equal(config.indexingEnabled, true);
});
test('local public pages remain noindex with no invented canonical or schema', () => {
  for (const pathname of PUBLIC_ROUTES) { const meta = routeMetadata({ pathname }); assert.match(meta.robots, /noindex/); assert.equal(meta.canonical, ''); assert.equal(meta.jsonld, null); }
});
test('public static page titles and descriptions are distinct', () => {
  const metas = PUBLIC_ROUTES.map(pathname => routeMetadata({ pathname, config }));
  assert.equal(new Set(metas.map(meta => meta.title)).size, metas.length);
  assert.equal(new Set(metas.map(meta => meta.description)).size, metas.length);
  assert.ok(metas.every(meta => meta.indexable));
});
test('account, AI, personalized, search and unknown pages remain noindex', () => {
  for (const pathname of ['/login', '/register', '/reset-password', '/profile', '/dashboard', '/sunny', '/meal-planner', '/search', '/pantry', '/household', '/admin', '/creator', `/edit-recipe/${id}`, `/cook-along/${id}`, '/not-real']) {
    const meta = routeMetadata({ pathname, search: '?prompt=private-secret', config });
    assert.match(meta.robots, /noindex/); assert.equal(meta.canonical, ''); assert.equal(meta.jsonld, null); assert.ok(!JSON.stringify(meta).includes('private-secret'));
  }
});
test('private or unverified owner-visible recipes never get share snapshots', () => {
  for (const changes of [{ recipe: { ...recipe, public: false, title: 'Owner secret' } }, { publicVerified: false }, { loading: true }, { error: true }]) {
    const meta = metadata(changes); assert.match(meta.robots, /noindex/); assert.equal(meta.jsonld, null); assert.equal(meta.image, ''); assert.equal(meta.canonical, ''); assert.ok(!meta.title.includes('Owner secret'));
  }
});
test('real recipe schema includes only source facts and individual author identity', () => {
  const meta = metadata(); const data = meta.jsonld;
  assert.equal(meta.canonical, `${origin}/recipes/${id}`); assert.equal(data.name, recipe.title); assert.equal(data.author['@type'], 'Person'); assert.equal(data.author.name, 'Cassie Best');
  assert.deepEqual(data.recipeIngredient, ['200 g rice', 'mushrooms']); assert.deepEqual(data.recipeInstructions.map(step => step.text), ['Cook rice.', 'Add mushrooms.']);
  assert.equal(data.totalTime, 'PT30M'); assert.equal(data.recipeYield, '4 servings'); assert.equal(data.isBasedOn, recipe.sourceUrl); assert.match(data.creditText, /All rights reserved/);
  for (const key of ['cookTime', 'prepTime', 'datePublished', 'nutrition', 'aggregateRating', 'suitableForDiet']) assert.ok(!(key in data), key);
});
test('explicit team names use Organization rather than mislabelling contributors', () => { assert.equal(metadata({ recipe: { ...recipe, sourceAuthor: 'Good Food team' } }).jsonld.author['@type'], 'Organization'); });
test('unknown times/yields and unavailable original images do not gain fabricated values', () => {
  const data = metadata({ recipe: { ...recipe, cookingTime: 0, servings: 0 } }).jsonld; assert.ok(!('totalTime' in data)); assert.ok(!('recipeYield' in data));
  for (const imageUrl of ['https://storage.example.org/signed/photo?token=secret', '/storage/v1/object/public/recipe-images/user/photo.jpg', '/recipe-images/../secret.jpg']) { assert.equal(sourceImageURL({ ...recipe, imageUrl }, origin), ''); assert.equal(metadata({ recipe: { ...recipe, imageUrl } }).jsonld, null); }
});
test('recipe query variants have clean canonical URLs and noindex', () => { const meta = metadata({ search: '?householdId=secret&servings=2' }); assert.match(meta.robots, /noindex/); assert.equal(meta.canonical, `${origin}/recipes/${id}`); assert.equal(meta.jsonld, null); assert.ok(!JSON.stringify(meta).includes('secret')); });
test('head generation escapes HTML and contains one canonical, robots and schema', () => {
  const meta = metadata(); meta.title = 'Rice " & </title><script>alert(1)</script>'; const head = renderHead(meta);
  assert.ok(!head.includes('<script>alert')); assert.equal((head.match(/rel="canonical"/g) || []).length, 1); assert.equal((head.match(/name="robots"/g) || []).length, 1); assert.equal((head.match(/type="application\/ld\+json"/g) || []).length, 1);
  const value = { text: '</script>\u2028&' }; assert.ok(!safeJSON(value).includes('</script>')); assert.deepEqual(JSON.parse(safeJSON(value)), value);
});
test('ingredient text preserves unknown quantities instead of inventing them', () => { assert.deepEqual(ingredientLines({ ingredients: [{ ingredientName: 'salt', quantity: '', unit: '' }, { ingredientName: 'Unknown', quantity: '2', unit: 'g' }] }), ['salt']); });
test('fresh initial public recipe metadata survives loading but is never reused after navigation', () => {
  const meta = metadata(); const pathname = `/recipes/${id}`;
  assert.equal(freshInitialRecipeMetadata(meta, pathname, '', false), meta);
  assert.equal(freshInitialRecipeMetadata(meta, pathname, '', true), null);
  assert.equal(freshInitialRecipeMetadata(meta, '/recipes/other', '', false), null);
  assert.equal(freshInitialRecipeMetadata(meta, pathname, '?private=1', false), null);
  assert.equal(freshInitialRecipeMetadata(metadata({ recipe: { ...recipe, public: false } }), pathname, '', false), null);
  assert.equal(freshInitialRecipeMetadata(metadata({ error: true }), pathname, '', false), null);
});
test('fresh catalog metadata survives loading only on the original document URI', () => {
  const meta = routeMetadata({ pathname: '/recipes', config });
  assert.equal(freshInitialPageMetadata(meta, '/recipes', '', false), meta);
  assert.equal(freshInitialPageMetadata(meta, '/recipes', '', true), null);
  assert.equal(freshInitialPageMetadata(meta, '/recipes', '?page=1', false), null);
  assert.equal(freshInitialPageMetadata(routeMetadata({ pathname: '/recipes', config, error: true }), '/recipes', '', false), null);
  assert.equal(freshInitialPageMetadata(routeMetadata({ pathname: '/profile', config }), '/profile', '', false), null);
});
