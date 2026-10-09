import { httpClient } from './httpClient';
export function platformRequest(path, { authenticated = false, ...options } = {}) {
  return httpClient.json(`/platform/${path}`, { ...options, auth: authenticated ? 'required' : 'none', service: 'This request' });
}
