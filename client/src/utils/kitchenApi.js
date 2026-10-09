import { aiRequest } from './aiControl';
import { httpClient } from './httpClient';
import { scopedKitchenPath } from './kitchen';

/** kitchen.v1 / growth.v1: actor comes from JWT; writes carry their domain CAS version. */
export function kitchenRequest(path, { householdId, body, method, signal, params, actorId, timeoutMs, headers } = {}) {
  const localAI = /\/(?:voice\/|suggestions|ask|speak)(?:.*)?$/.test(path);
  const deadline = timeoutMs ?? (localAI ? 150000 : 30000);
  const request = localAI ? aiRequest : httpClient.json;
  return request(`/kitchen${scopedKitchenPath(path, householdId, params)}`, {
    body, method, signal, actorId, timeoutMs: deadline, headers: localAI ? { ...headers, 'X-Local-AI-Timeout-Ms': String(deadline), 'X-Local-AI-Request-Id': crypto.randomUUID() } : headers, auth: 'required', service: 'Your kitchen',
    conflictMessage: 'This record changed elsewhere. Your edits are still here. Reload the latest data before trying again.',
  });
}
