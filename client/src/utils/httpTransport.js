import { readJSON, requestFailure } from './requestFailure.js';

const abortError = () => new DOMException('Cancelled', 'AbortError');
const check = signal => { if (signal?.aborted) throw abortError(); };

/** Shared Java gateway transport. Actor checks happen before sending, with no response cache. */
export function createHttpTransport({ baseUrl = '/api', getSession, fetcher = fetch, defaultTimeoutMs = 30000 }) {
  async function raw(path, options = {}) {
    const { signal, auth = 'optional', actorId, timeoutMs = defaultTimeoutMs, body, headers, _read, onSession, onCancel, ...rest } = options;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) throw new Error('Invalid request deadline.');
    check(signal);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const notifyCancel = () => { try { onCancel?.(); } catch { /* Cancellation must not hide the original outcome. */ } };
    controller.signal.addEventListener('abort', notifyCancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let rejectAbort;
    const cancelled = new Promise((_, reject) => {
      rejectAbort = () => reject(abortError());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const work = async () => {
      let session = null;
      if (auth !== 'none') {
        try { const result = await getSession(); if (!result.error) session = result.data?.session || null; }
        catch (error) { if (error.name === 'AbortError') throw error; }
      }
      check(controller.signal);
      if ((auth === 'required' && !session?.access_token)
          || (actorId !== undefined && (session?.user?.id || null) !== actorId)) throw requestFailure(401);
      onSession?.(session);
      const requestHeaders = new Headers(headers);
      requestHeaders.set('Accept', 'application/json');
      if (session?.access_token) requestHeaders.set('Authorization', `Bearer ${session.access_token}`);
      else requestHeaders.delete('Authorization');
      if (body !== undefined && typeof body !== 'string') requestHeaders.set('Content-Type', 'application/json');
      const url = /^https?:\/\//i.test(path) || path.startsWith(`${baseUrl.replace(/\/+$/, '')}/`)
        ? path : `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
      try {
        const response = await fetcher(url, { ...rest, credentials: 'omit', signal: controller.signal,
          headers: requestHeaders, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
        check(controller.signal);
        return _read ? await _read(response) : response;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        const failure = requestFailure(undefined, 'Connection lost. Check your network, then try again.');
        failure.cause = error; throw failure;
      }
    };
    try { return await Promise.race([work(), cancelled]); }
    catch (error) { if (timedOut && !signal?.aborted) throw requestFailure(504); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', rejectAbort); controller.signal.removeEventListener('abort', notifyCancel); }
  }
  async function json(path, { service, conflictMessage, contractVersion, unreadableMessage, ...options } = {}) {
    const { response, data } = await raw(path, { ...options, method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      _read: async response => ({ response, data: response.status === 204 ? {} : await readJSON(response) }) });
    check(options.signal);
    if (!response.ok) {
      const failure = requestFailure(response.status, data?.message, service, conflictMessage);
      const retryAfter = Number(response.headers?.get('Retry-After'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfter = Math.min(retryAfter, 180);
      throw failure;
    }
    if (!data || typeof data !== 'object' || (contractVersion && data.contractVersion !== contractVersion))
      throw new Error(unreadableMessage || `${service || 'The service'} returned an unreadable response. Please try again.`);
    return data;
  }
  return { raw, json };
}
