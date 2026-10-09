import { catalogRequest } from "../utils/catalogApi";
import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { apiUrl } from '../utils/api';
import { freshInitialPageMetadata, freshInitialRecipeMetadata, isPublicRecipe, recipeIdFromPath, routeMetadata, seoConfig } from '../utils/seo';

let bootstrap = null;
try { bootstrap = JSON.parse(document.getElementById('lmc-seo-config')?.textContent || 'null'); } catch { /* Use the safe build defaults if the runtime script is absent. */ }
const config = seoConfig(bootstrap || { publicSiteOrigin: import.meta.env.VITE_PUBLIC_SITE_ORIGIN, indexingEnabled: import.meta.env.VITE_SEO_INDEXING_ENABLED });
const initialDocumentRoute = window.location.pathname + window.location.search;
let leftInitialDocumentRoute = false;
function applyMetadata(meta) {
  document.head.querySelectorAll('[data-lmc-seo]').forEach(node => node.remove());
  document.title = meta.title;
  const add = (attributes) => { const element = document.createElement('meta'); element.dataset.lmcSeo = ''; Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); document.head.append(element); };
  add({ name: 'description', content: meta.description }); add({ name: 'robots', content: meta.robots });
  add({ property: 'og:site_name', content: 'Let Me Cook' }); add({ property: 'og:title', content: meta.title }); add({ property: 'og:description', content: meta.description }); add({ property: 'og:type', content: meta.type });
  add({ name: 'twitter:card', content: meta.image ? 'summary_large_image' : 'summary' }); add({ name: 'twitter:title', content: meta.title }); add({ name: 'twitter:description', content: meta.description });
  if (meta.canonical) { const link = document.createElement('link'); link.dataset.lmcSeo = ''; link.rel = 'canonical'; link.href = meta.canonical; document.head.append(link); add({ property: 'og:url', content: meta.canonical }); }
  if (meta.image) { add({ property: 'og:image', content: meta.image }); add({ name: 'twitter:image', content: meta.image }); }
  if (meta.jsonld) { const script = document.createElement('script'); script.dataset.lmcSeo = ''; script.type = 'application/ld+json'; script.textContent = JSON.stringify(meta.jsonld); document.head.append(script); }
}

export default function SEO() {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => {
    // Reset before a new route can display stale recipe/share information.
    if (pathname + search !== initialDocumentRoute) leftInitialDocumentRoute = true;
    const serverMetadata = !leftInitialDocumentRoute && bootstrap?.metadata?.pathname === pathname && !search ? bootstrap.metadata : null;
    applyMetadata(serverMetadata || routeMetadata({ pathname, search, loading: Boolean(recipeIdFromPath(pathname)), config }));
  }, [pathname, search]);
  return null;
}

export function PageSEO({ loading = false, error = false }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const fresh = loading && !error ? freshInitialPageMetadata(bootstrap?.metadata, pathname, search, leftInitialDocumentRoute) : null;
    applyMetadata(fresh || routeMetadata({ pathname, search, loading, error: Boolean(error), config }));
  }, [pathname, search, loading, error]);
  return null;
}

export function RecipeSEO({ recipe, loading }) {
  const { pathname, search } = useLocation();
  const id = recipeIdFromPath(pathname);
  const recipeId = recipe?.id;
  useEffect(() => {
    const controller = new AbortController();
    if (loading || !id || !recipeId || !isPublicRecipe(recipe)) {
      const fresh = loading ? freshInitialRecipeMetadata(bootstrap?.metadata, pathname, search, leftInitialDocumentRoute) : null;
      applyMetadata(fresh || routeMetadata({ pathname, search, loading, config }));
      return () => controller.abort();
    }
    // A public-but-unapproved demo recipe can be visible to its owner. The
    // anonymous API is authoritative for what can appear in shared metadata.
    catalogRequest(apiUrl(`/recipes/${id}`), { credentials: 'omit', signal: controller.signal })
      .then(publicRecipe => { if (!controller.signal.aborted) applyMetadata(routeMetadata({ pathname, search, recipe: publicRecipe, publicVerified: true, config })); })
      .catch(() => { if (!controller.signal.aborted) applyMetadata(routeMetadata({ pathname, search, error: true, config })); });
    return () => controller.abort();
  }, [id, recipeId, loading, pathname, search, recipe]);
  return null;
}

/** Publication remains noindex until an explicit deployment indexing policy includes collections. */
export function CollectionSEO({ collection, loading }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const meta = routeMetadata({ pathname, search, loading, error: !loading && !collection, config });
    const title = collection ? `${collection.name} | Let Me Cook` : loading ? 'Loading collection | Let Me Cook' : 'Collection unavailable | Let Me Cook';
    applyMetadata({ ...meta, title, description: collection?.description || 'Explore a recipe collection on Let Me Cook.', robots: 'noindex, follow', canonical: '', jsonld: null, image: '' });
  }, [pathname, search, collection, loading]);
  return null;
}
