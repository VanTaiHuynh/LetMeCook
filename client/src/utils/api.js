import { httpClient } from './httpClient';
// Keep API requests on the web origin unless a separate backend is configured.
const apiBase = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

export function apiUrl(path) {
  return `${apiBase}/${path.replace(/^\/+/, '')}`;
}

export async function authenticatedFetch(url, options = {}) {
  return httpClient.raw(url, { ...options, auth: 'required' });
}
