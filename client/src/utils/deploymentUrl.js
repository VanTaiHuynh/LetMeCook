// Local browsing keeps the local gateway; the published site uses HTTPS on its own origin.
export function browserSupabaseUrl(localUrl, publicSiteOrigin, pageOrigin) {
  const fallback = (localUrl || '').replace(/\/+$/, '');
  try {
    const site = new URL(publicSiteOrigin);
    const page = new URL(pageOrigin);
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) return fallback;
    const sameHost = page.hostname === site.hostname || page.hostname === `www.${site.hostname}`;
    if (page.protocol === 'https:' && page.port === site.port && sameHost) return page.origin;
  } catch { /* An unset public origin is the normal local-only configuration. */ }
  return fallback;
}

// Resolve old stored public-object URLs without rewriting any recipe or account data.
export function remapSupabaseStorageUrl(value, localUrl, effectiveUrl) {
  if (typeof value !== 'string') return value;
  try {
    const object = new URL(value);
    const local = new URL(localUrl);
    const effective = new URL(effectiveUrl);
    if (object.username || object.password || object.origin !== local.origin || !object.pathname.startsWith('/storage/v1/object/public/')) return value;
    return effective.origin + object.pathname + object.search + object.hash;
  } catch { return value; }
}
