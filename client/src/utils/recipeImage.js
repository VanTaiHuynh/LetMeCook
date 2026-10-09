export function storedRecipeImagePath(value, storageUrl, pageOrigin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const image = new URL(value, pageOrigin);
    const base = new URL(storageUrl);
    const prefix = '/storage/v1/object/public/recipe-images/';
    if (image.origin !== base.origin || !image.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(image.pathname.slice(prefix.length));
    return path && !path.split('/').some(segment => segment === '.' || segment === '..') ? path : null;
  } catch { return null; }
}
