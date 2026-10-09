import { aiRequest } from './aiControl';
import { httpClient } from './httpClient';
export function plannerRequest(path, { authenticated = false, body, timeoutMs = 150000, requestId = crypto.randomUUID(), ...options } = {}) {
  const request = body && /\/(?:generate|preview|recalculate|refresh-prices)$/.test(path) ? aiRequest : httpClient.json;
  return request(`/meal-plans${path}`, { ...options, body, timeoutMs,
    headers: { 'X-Local-AI-Timeout-Ms': String(timeoutMs), 'X-Local-AI-Request-Id': requestId },
    auth: authenticated ? 'required' : 'optional', service: 'The planner',
    conflictMessage: 'This week was updated elsewhere. Your draft is intact. Load the saved week before replacing it.' });
}
