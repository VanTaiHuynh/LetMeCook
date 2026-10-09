import { httpClient } from './httpClient';
import { createHttpTransport } from './httpTransport';
import { createAiTransport } from './aiTransport';

const ai = createAiTransport({ transport: httpClient, cancelRequest: entry => {
  // Keep original auth only for cancellation of this request. A new account never supplies this capability.
  const session = entry.session;
  const cancellation = createHttpTransport({ baseUrl: (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, ''),
    getSession: async () => ({ data: { session } }) });
  return cancellation.json(`/ai/requests/${entry.requestId}/cancel`, { body: { cancelToken: entry.cancelToken },
    actorId: session?.user?.id || null, timeoutMs: 5000, service: 'Cancellation' });
} });
export const aiRequest = ai.request;
export const cancelAiRequest = ai.cancel;
