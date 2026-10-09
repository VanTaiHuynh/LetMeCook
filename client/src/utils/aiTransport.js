/** Cancellation capabilities are request-scoped, not account or query caches. */
export function createAiTransport({ transport, cancelRequest, randomId = () => crypto.randomUUID() }) {
  const requests = new WeakMap();
  const cancelEntry = entry => {
    if (!entry || !entry.started || entry.cancelled) return Promise.resolve(null);
    entry.cancelled = true;
    return Promise.resolve(cancelRequest({ ...entry })).catch(() => null);
  };
  async function request(path, options = {}) {
    const requestId = options.requestId || randomId();
    const cancelToken = randomId().replaceAll('-', '') + randomId().replaceAll('-', '');
    const timeoutMs = options.timeoutMs ?? 150000;
    const entry = { requestId, cancelToken, session: null, started: false, cancelled: false };
    const onAbort = () => { void cancelEntry(entry); };
    if (options.signal) { requests.set(options.signal, entry); options.signal.addEventListener('abort', onAbort, {once:true}); }
    try {
      return await transport.json(path, { ...options, timeoutMs,
        onSession: session => { entry.session = session; entry.started = true; }, onCancel: onAbort,
        headers: { ...options.headers, 'X-Local-AI-Timeout-Ms': String(timeoutMs), 'X-Local-AI-Request-Id': requestId, 'X-Local-AI-Cancel-Token': cancelToken } });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal && requests.get(options.signal) === entry) requests.delete(options.signal);
      entry.session = null;
    }
  }
  return { request, cancel: signal => cancelEntry(signal && requests.get(signal)) };
}
