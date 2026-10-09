import { httpClient } from './httpClient';
/** Anonymous catalog reads intentionally omit tokens; private reads use recipeReadClient/account adapters. */
export const catalogFetch = (path, options = {}) => httpClient.raw(path, { ...options, auth: 'none' });
export const catalogRequest = (path, options = {}) => httpClient.json(path, { ...options, auth: 'none', service: 'Recipes' });
export async function recipeTagOptions(signal) {
  const [dietary, cuisines, categories] = await Promise.all(['/dietary-preferences', '/cuisines', '/categories'].map(path => catalogRequest(path, { signal })));
  if (![dietary, cuisines, categories].every(rows => Array.isArray(rows) && rows.every(row => row.id && typeof row.name === 'string'))) throw new Error('Recipe tags could not be loaded. Try again.');
  return { dietary, cuisines, categories };
}
