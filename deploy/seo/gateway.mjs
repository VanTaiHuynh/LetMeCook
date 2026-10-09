import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PUBLIC_ROUTES, escapeHTML, ingredientLines, isPublicRecipe, recipeIdFromPath, renderHead, routeMetadata, safeJSON, seoConfig, sourceImageURL } from '../../client/src/utils/seo.js';
import { recipeSteps, recipeText } from '../../client/src/utils/recipeContent.js';

export const SITEMAP_PAGE_SIZE = 500;
export const MAX_SITEMAP_RECIPES = 50000;
const xml = value => escapeHTML(value);
const XML_START = '<?xml version="1.0" encoding="UTF-8"?>';
const statusError = status => Object.assign(new Error('Anonymous catalog unavailable'), { status });

export function anonymousCatalog({ fetchImpl = fetch, base = 'http://127.0.0.1:9402' } = {}) {
  // This URL is internal configuration, never taken from Host, query or recipe fields.
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/') throw new Error('Catalog must use the local backend origin');
  const getJSON = async path => {
    const response = await fetchImpl(origin.origin + path, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw statusError([401, 403, 404].includes(response.status) ? 404 : 503);
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > 20 * 1024 * 1024) throw statusError(503); chunks.push(Buffer.from(chunk)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw statusError(503); }
  };
  return { recipe: id => getJSON(`/api/recipes/${id}`), page: (page, size = SITEMAP_PAGE_SIZE, sort = 'title,asc&sort=id,asc') => getJSON(`/api/recipes?page=${page}&size=${size}&sort=${sort}`) };
}

function readableContent(meta, recipe, catalog) {
  const nav = '<nav aria-label="Site"><a href="/">Let Me Cook</a> · <a href="/recipes">Recipes</a> · <a href="/features">Features</a> · <a href="/how-it-works">How it works</a> · <a href="/about">About</a> · <a href="/contact">Contact</a></nav>';
  let content = `<h1>${escapeHTML(meta.title.replace(/ \| Let Me Cook$/, ''))}</h1><p>${escapeHTML(meta.description)}</p>`;
  if (recipe && isPublicRecipe(recipe)) {
    content = `<h1>${escapeHTML(recipeText(recipe.title))}</h1><p>${escapeHTML(recipeText(recipe.description))}</p>`;
    // Use the same local asset path as React, retaining Nginx image permissions.
    if (recipe.imageKind === 'source' && /^\/recipe-images\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$/i.test(recipe.imageUrl || '')) content += `<img src="${escapeHTML(recipe.imageUrl)}" alt="${escapeHTML(recipeText(recipe.title))}">`;
    if (recipe.servings > 0) content += `<p>Servings: ${escapeHTML(recipe.servings)}</p>`;
    if (Number.isInteger(recipe.cookingTime) && recipe.cookingTime > 0) content += `<p>Total time: ${recipe.cookingTime} minutes</p>`;
    const ingredients = ingredientLines(recipe); if (ingredients.length) content += `<h2>Ingredients</h2><ul>${ingredients.map(text => `<li>${escapeHTML(text)}</li>`).join('')}</ul>`;
    const steps = recipeSteps(recipe.directions); if (steps.length) content += `<h2>Method</h2><ol>${steps.map(text => `<li>${escapeHTML(text)}</li>`).join('')}</ol>`;
  }
  if (catalog) {
    content += `<ul>${catalog.content.filter(isPublicRecipe).map(recipe => `<li><a href="/recipes/${escapeHTML(recipe.id)}">${escapeHTML(recipeText(recipe.title))}</a></li>`).join('')}</ul>`;
    if (!catalog.last) content += `<p><a href="/recipes?page=${catalog.number + 1}">Next recipes</a></p>`;
  }
  return `${nav}<main>${content}</main><footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>`;
}

export function renderDocument(template, meta, { recipe = null, catalog = null, config = seoConfig() } = {}) {
  const withoutOldHead = template.replace(/<title\b[^>]*>[^]*?<\/title>/gi, '').replace(/<meta\b[^>]*(?:name=["'](?:description|robots|twitter:[^"']*)["']|property=["']og:[^"']*["'])[^>]*>/gi, '').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '').replace(/<script\b[^>]*data-lmc-seo[^>]*>[^]*?<\/script>/gi, '');
  const publicConfig = `<script id="lmc-seo-config" type="application/json">${safeJSON({ publicSiteOrigin: config.origin, indexingEnabled: config.indexingEnabled, metadata: meta })}</script>`;
  return withoutOldHead.replace('</head>', `${renderHead(meta)}\n${publicConfig}\n</head>`).replace(/<div id="root"><\/div>/, `<div id="root">${readableContent(meta, recipe, catalog)}</div>`);
}

export function robotsText(config) {
  // Allow rendering so crawlers can see noindex; robots.txt is not authorization.
  return `User-agent: *\nAllow: /\n${config.indexingEnabled ? `Sitemap: ${config.origin}/sitemap.xml\n` : ''}`;
}
function urlset(entries) { return `${XML_START}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.join('')}</urlset>`; }
export function staticSitemap(config) { return urlset(config.indexingEnabled ? PUBLIC_ROUTES.map(path => `<url><loc>${xml(config.origin + path)}</loc></url>`) : []); }
export function recipeSitemap(rows, config) {
  return urlset(config.indexingEnabled ? rows.filter(isPublicRecipe).filter(recipe => recipeIdFromPath(`/recipes/${recipe.id}`)).map(recipe => {
    const image = sourceImageURL(recipe, config.origin);
    return `<url><loc>${xml(`${config.origin}/recipes/${String(recipe.id).toLowerCase()}`)}</loc>${image ? `<image:image><image:loc>${xml(image)}</image:loc></image:image>` : ''}</url>`;
  }) : []);
}
export function sitemapIndex(count, config) {
  const pages = Math.ceil(Math.min(MAX_SITEMAP_RECIPES, Math.max(0, count)) / SITEMAP_PAGE_SIZE);
  const paths = config.indexingEnabled ? ['/sitemaps/pages.xml', ...Array.from({ length: pages }, (_, page) => `/sitemaps/recipes-${page + 1}.xml`)] : [];
  return `${XML_START}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<sitemap><loc>${xml(config.origin + path)}</loc></sitemap>`).join('')}</sitemapindex>`;
}

export async function resolveRequest(rawURL, { template, config = seoConfig(), catalog } = {}) {
  const url = new URL(rawURL, 'http://local.invalid'); const { pathname, search } = url;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (pathname === '/__seo/health') return { status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"status":"ok"}' };
  if (pathname === '/robots.txt') return { status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }, body: robotsText(config) };
  if (pathname === '/sitemap.xml' || /^\/sitemaps\/(?:pages|recipes-\d+)\.xml$/.test(pathname)) {
    headers['Content-Type'] = 'application/xml; charset=utf-8'; headers['X-Robots-Tag'] = 'noindex';
    try {
      if (!config.indexingEnabled) return { status: 200, headers, body: pathname === '/sitemap.xml' ? sitemapIndex(0, config) : staticSitemap(config) };
      if (pathname === '/sitemap.xml') { const page = await catalog.page(0, 1); return { status: 200, headers, body: sitemapIndex(Number(page.totalElements) || 0, config) }; }
      if (pathname === '/sitemaps/pages.xml') return { status: 200, headers, body: staticSitemap(config) };
      const pageNumber = Number(/recipes-(\d+)/.exec(pathname)[1]) - 1;
      if (pageNumber < 0 || pageNumber >= MAX_SITEMAP_RECIPES / SITEMAP_PAGE_SIZE) return { status: 404, headers, body: staticSitemap(seoConfig()) };
      const page = await catalog.page(pageNumber); if (!Array.isArray(page.content) || !page.content.length) return { status: 404, headers, body: staticSitemap(seoConfig()) };
      return { status: 200, headers, body: recipeSitemap(page.content, config) };
    } catch { return { status: 503, headers: { ...headers, 'Retry-After': '60' }, body: staticSitemap(seoConfig()) }; }
  }
  let recipe = null; let list = null; let status = 200; let failed = false;
  const id = recipeIdFromPath(pathname);
  if (id) {
    try { recipe = await catalog.recipe(id); if (!isPublicRecipe(recipe) || String(recipe.id).toLowerCase() !== id) { recipe = null; status = 404; failed = true; } }
    catch (error) { status = error.status === 404 ? 404 : 503; failed = true; }
  } else if (pathname.replace(/\/$/, '') === '/recipes') {
    // Only the same unfiltered listing is rendered. Facet/search requests remain
    // noindex and are handled by the client without inventing different content.
    const params = url.searchParams; const page = Number(params.get('page') || 0);
    if ([...params.keys()].every(key => key === 'page') && Number.isInteger(page) && page >= 0 && page < 10000) {
      try { list = await catalog.page(page, 24, 'createdAt,desc'); if (!Array.isArray(list.content)) throw new Error('bad page'); }
      catch { failed = true; }
    }
  }
  const meta = routeMetadata({ pathname, search, recipe, publicVerified: Boolean(recipe), error: failed, config });
  if (!meta.known) status = 404;
  if (status === 200 && pathname !== meta.pathname) return { status: 301, headers: { ...headers, Location: meta.pathname + search, 'X-Robots-Tag': meta.robots }, body: '' };
  headers['X-Robots-Tag'] = meta.robots;
  if (status === 503) headers['Retry-After'] = '60';
  return { status, headers, body: renderDocument(template, meta, { recipe, catalog: list, config }) };
}

export async function startGateway({ config, port = 9403, templatePath = '/usr/share/nginx/html/index.html', backend = 'http://127.0.0.1:9402' } = {}) {
  const template = await readFile(templatePath, 'utf8'); const catalog = anonymousCatalog({ base: backend });
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    try { const result = await resolveRequest(request.url, { template, config, catalog }); response.writeHead(result.status, result.headers); response.end(request.method === 'HEAD' ? '' : result.body); }
    catch { response.writeHead(503, { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' }); response.end('Page temporarily unavailable.'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
