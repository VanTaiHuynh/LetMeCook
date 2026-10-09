import { aiRequest } from '../../utils/aiControl';
import { httpClient } from '../../utils/httpClient';

export function guestCookRequest(recipeId, action, { body, signal } = {}) {
  const path = `/public/cook/recipes/${encodeURIComponent(recipeId)}${action ? `/${action}` : ''}`;
  const request = action ? aiRequest : httpClient.json;
  return request(path, { body, signal, auth: 'none', timeoutMs: action ? 150000 : 30000, service: 'Cook along',
    ...(action ? {} : { contractVersion: 'guest-cook.v1' }), conflictMessage: 'This recipe changed. Reload its cooking steps.' });
}
