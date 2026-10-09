import { aiRequest } from './aiControl';

/** local-ai.v2: actor-bound optional identity; one shared deadline and cancellation signal. */
export function sunnyRequest(path, { body, signal, actorId, timeoutMs = 150000, requestId = crypto.randomUUID() } = {}) {
  return aiRequest(`/ai/${path}`, { body, signal, actorId, timeoutMs,
    headers: { 'X-Local-AI-Timeout-Ms': String(timeoutMs), 'X-Local-AI-Request-Id': requestId }, service: 'Sunny' });
}
