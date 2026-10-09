import { ingredientQuantity, recipeSteps, recipeText } from './recipeContent.js';

export const SITE_NAME = 'Let Me Cook';
export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RECIPE_PATH = new RegExp(`^/recipes/(${UUID_PATTERN})/?$`, 'i');
const ROUTES = {
  '/': ['Find your next favourite meal', 'Find recipes for your taste, cook with what you have, plan your week and shop with a clear list. Sunny helps you cook step by step.', true],
  '/recipes': ['Browse recipes', 'Explore recipes with original photos, ingredients and cooking steps. Filter by meal type, listed ingredients, source diet labels and cooking time.', true],
  '/features': ['Recipes, meal plans and cooking help', 'Discover meals for your taste, use pantry ingredients, plan the week, make shopping lists and cook with Sunny’s photo and voice help.', true],
  '/how-it-works': ['From meal ideas to dinner', 'Start with what sounds good or what’s in your kitchen. Find a recipe, plan your meals, shop for what’s missing and cook with Sunny.', true],
  '/about': ['About Let Me Cook', 'Let Me Cook helps you turn “what should I cook?” into meals you enjoy, with personal recipe ideas, pantry planning and a cooking companion.', true],
  '/contact': ['Contact Let Me Cook', 'Contact the Let Me Cook team with questions, feedback or suggestions about recipes and cooking tools.', true],
  '/terms': ['Terms of use', 'Read the Let Me Cook terms, including account responsibilities, recipe sources, content permissions and use of cooking tools.', true],
  '/privacy': ['Privacy policy', 'Read how Let Me Cook handles accounts, local cooking tools and optional activity evidence, including consent, retention and deletion choices.', true],
  '/cook-along': ['Cook along', 'Listen to recipe steps, set timers and ask Sunny as you cook. Try it without creating an account.'],
  '/sunny': ['Cook with Sunny', 'Find recipes from a request or confirmed photo ingredients. Sunny keeps your chosen source diet labels and listed ingredient exclusions in the search.'],
  '/search': ['Recipe search', 'Review recipes matching your selected search filters.'],
  '/meal-planner': ['Meal planner', 'Choose meals, review your shopping list and save a plan in your own kitchen.'],
  '/newsletter': ['Newsletter preferences', 'Manage your Let Me Cook newsletter subscription.'],
  '/login': ['Log in', 'Log in to your Let Me Cook account.'],
  '/register': ['Create an account', 'Create a Let Me Cook account to save recipes and use your own kitchen.'],
  '/forgot-password': ['Reset your password', 'Request a password reset for your Let Me Cook account.'],
  '/reset-password': ['Choose a new password', 'Securely update your Let Me Cook account password.'],
  '/dashboard': ['Your kitchen', 'Return to your saved recipes and cooking tools.'],
  '/profile': ['Your profile', 'Manage your Let Me Cook profile.'],
  '/edit-profile': ['Edit your profile', 'Update your account profile and saved preferences.'],
  '/favourites': ['Saved recipes', 'Find the recipes saved in your Let Me Cook account.'],
  '/user-recipe': ['Your recipes', 'Manage the recipes in your Let Me Cook account.'],
  '/create-recipe': ['Create a recipe', 'Add a recipe to your Let Me Cook account.'],
  '/pantry': ['Your pantry', 'Review ingredients in your selected kitchen.'],
  '/household': ['Household kitchen', 'Manage your selected household kitchen and its members.'],
  '/evidence': ['Your activity evidence', 'Review optional activity evidence and consent choices for your account.'],
  '/creator': ['Creator workspace', 'Manage your private recipe workspace and reviewed substitution rules.'],
  '/admin': ['Operations', 'Manage authorized Let Me Cook operations.'],
  '/unauthorized': ['Log in to continue', 'This page requires access to your Let Me Cook account.'],
  '/forbidden': ['Access unavailable', 'This page is unavailable for this account.'],
};

export function publicOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return '';
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return '';
    return url.origin;
  } catch { return ''; }
}

export function seoConfig({ publicSiteOrigin = '', indexingEnabled = false } = {}) {
  const origin = publicOrigin(publicSiteOrigin);
  return { origin, indexingEnabled: Boolean(origin) && (indexingEnabled === true || indexingEnabled === 'true') };
}

export function recipeIdFromPath(pathname) { return RECIPE_PATH.exec(pathname)?.[1]?.toLowerCase() || ''; }
export function freshInitialRecipeMetadata(metadata, pathname, search, leftInitialDocumentRoute) {
  return !leftInitialDocumentRoute && !search && metadata?.recipeVerified === true && metadata.pathname === pathname ? metadata : null;
}
export function freshInitialPageMetadata(metadata, pathname, search, leftInitialDocumentRoute) {
  return !leftInitialDocumentRoute && !search && metadata?.pageVerified === true && metadata.pathname === pathname ? metadata : null;
}
export function isPublicRecipe(recipe) { return recipe?.public === true || (recipe?.public === undefined && recipe?.isPublic === true); }
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
export function safeJSON(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, char => char === '\u2028' ? '\\u2028' : '\\u2029'); }
export function safeSourceURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

export function sourceImageURL(recipe, origin) {
  // Source assets have permanent, permission-gated URLs. Never advertise
  // user storage URLs or expiring signed upload URLs as crawlable images.
  const image = String(recipe?.imageUrl || '');
  if (!origin || recipe?.imageKind !== 'source' || !/^\/recipe-images\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$/i.test(image)) return '';
  return origin + image;
}

export function ingredientLines(recipe) {
  return (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).map(item => {
    const name = recipeText(item?.ingredientName);
    return name && name.toLowerCase() !== 'unknown' ? [ingredientQuantity(item.quantity), recipeText(item.unit), name].filter(Boolean).join(' ') : '';
  }).filter(Boolean);
}

function description(value) { return recipeText(value).replace(/\s+/g, ' ').slice(0, 180).trim(); }
export function recipeJSONLD(recipe, config, canonical) {
  const image = sourceImageURL(recipe, config.origin);
  if (!config.indexingEnabled || !isPublicRecipe(recipe) || !image || !recipeText(recipe?.title)) return null;
  const data = { '@context': 'https://schema.org', '@type': 'Recipe', name: recipeText(recipe.title), image: [image], url: canonical };
  const text = description(recipe.description); if (text) data.description = text;
  const ingredients = ingredientLines(recipe); if (ingredients.length) data.recipeIngredient = ingredients;
  const steps = recipeSteps(recipe.directions); if (steps.length) data.recipeInstructions = steps.map(text => ({ '@type': 'HowToStep', text }));
  // The imported time is total minutes; there is no separate prep/cook split.
  if (Number.isInteger(recipe.cookingTime) && recipe.cookingTime > 0) data.totalTime = `PT${recipe.cookingTime}M`;
  if (Number.isFinite(recipe.servings) && recipe.servings > 0) data.recipeYield = `${recipe.servings} servings`;
  if (Array.isArray(recipe.categories) && recipe.categories.length) data.recipeCategory = recipe.categories.map(recipeText).filter(Boolean);
  if (Array.isArray(recipe.cuisines) && recipe.cuisines.length) data.recipeCuisine = recipe.cuisines.map(recipeText).filter(Boolean);
  const source = safeSourceURL(recipe.sourceUrl); if (source) data.isBasedOn = source;
  const author = recipeText(recipe.sourceAuthor || recipe.authorName);
  const organizations = ['good food', 'bbc good food', 'good food team', 'bbc good food team'];
  if (author && !/^(?:unknown|anonymous)$/i.test(author)) data.author = { '@type': organizations.includes(author.toLowerCase()) ? 'Organization' : 'Person', name: author };
  if (recipe.sourceLicense) data.creditText = [author, recipeText(recipe.sourceLicense), source].filter(Boolean).join(' · ');
  // Source labels do not certify dietary safety; imported dates, nutrition
  // and unverified review aggregates are deliberately not invented here.
  return data;
}

export function routeMetadata({ pathname = '/', search = '', recipe = null, publicVerified = false, loading = false, error = false, config = seoConfig() } = {}) {
  const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  const id = recipeIdFromPath(path);
  let route = ROUTES[path];
  let canonicalPath = path; let jsonld = null; let image = '';
  if (id) {
    canonicalPath = `/recipes/${id}`;
    if (!loading && !error && publicVerified && isPublicRecipe(recipe) && String(recipe.id).toLowerCase() === id) {
      route = [recipeText(recipe.title), description(recipe.description) || 'Read the listed ingredients and cooking steps for this recipe.', true];
      image = sourceImageURL(recipe, config.origin);
    } else route = [loading ? 'Loading recipe' : 'Recipe unavailable', 'This recipe may be private or unavailable. Explore the public collection for something else to cook.'];
  } else if (/^\/edit-recipe\//.test(path)) route = ['Edit your recipe', 'Update a recipe in your Let Me Cook account.'];
  else if (/^\/cook-along\//.test(path)) route = ['Cook along', 'Follow the cooking steps in your selected kitchen.'];
  const known = Boolean(route); route ||= ['Page not found', 'This page is unavailable. Return to Let Me Cook to find recipes and cooking tools.'];
  const indexable = Boolean(route[2]) && config.indexingEnabled && !search && !loading && !error;
  const canonical = config.origin && route[2] ? config.origin + canonicalPath : '';
  if (id && publicVerified && indexable) jsonld = recipeJSONLD(recipe, config, canonical);
  const recipeVerified = Boolean(id && !loading && !error && publicVerified && isPublicRecipe(recipe) && String(recipe.id).toLowerCase() === id);
  const pageVerified = Boolean(route[2] && !error && !loading);
  return { title: path === '/about' ? route[0] : `${route[0]} | ${SITE_NAME}`, description: route[1], robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow', canonical, image, type: 'website', jsonld, indexable, known, recipeVerified, pageVerified, pathname: canonicalPath };
}

export function renderHead(meta) {
  const tags = [`<title data-lmc-seo>${escapeHTML(meta.title)}</title>`, `<meta data-lmc-seo name="description" content="${escapeHTML(meta.description)}">`, `<meta data-lmc-seo name="robots" content="${escapeHTML(meta.robots)}">`, `<meta data-lmc-seo property="og:site_name" content="${SITE_NAME}">`, `<meta data-lmc-seo property="og:title" content="${escapeHTML(meta.title)}">`, `<meta data-lmc-seo property="og:description" content="${escapeHTML(meta.description)}">`, `<meta data-lmc-seo property="og:type" content="website">`, `<meta data-lmc-seo name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`, `<meta data-lmc-seo name="twitter:title" content="${escapeHTML(meta.title)}">`, `<meta data-lmc-seo name="twitter:description" content="${escapeHTML(meta.description)}">`];
  if (meta.canonical) tags.push(`<link data-lmc-seo rel="canonical" href="${escapeHTML(meta.canonical)}">`, `<meta data-lmc-seo property="og:url" content="${escapeHTML(meta.canonical)}">`);
  if (meta.image) tags.push(`<meta data-lmc-seo property="og:image" content="${escapeHTML(meta.image)}">`, `<meta data-lmc-seo name="twitter:image" content="${escapeHTML(meta.image)}">`);
  if (meta.jsonld) tags.push(`<script data-lmc-seo type="application/ld+json">${safeJSON(meta.jsonld)}</script>`);
  return tags.join('\n');
}

export const PUBLIC_ROUTES = Object.entries(ROUTES).filter(([, value]) => value[2]).map(([path]) => path);
