import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport } from './httpTransport.js';
const session = { user: { id: 'actor-a' }, access_token: 'fixture-token' };
const auth = async () => ({ data: { session } });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
test('required and expected identity fail before any request; public calls strip tokens', async () => {
  let count = 0;
  const transport = createHttpTransport({ getSession: auth, fetcher: async (_url, opts) => { count++; assert.equal(opts.headers.has('Authorization'), false); assert.equal(opts.credentials, 'omit'); return response({ ok: true }); } });
  await assert.rejects(transport.json('/kitchen/bootstrap', { auth: 'required', actorId: 'actor-b' }), error => error.status === 401);
  assert.equal(count, 0);
  await transport.json('/recipes', { auth: 'none', headers: { Authorization: 'must-be-removed' } });
  assert.equal(count, 1);
});
test('aborting during auth resolution prevents a stale actor request even if auth resolves later', async () => {
  let resolve; let sent = false;
  const controller = new AbortController();
  const transport = createHttpTransport({ getSession: () => new Promise(done => { resolve = done; }), fetcher: async () => { sent = true; return response({}); } });
  const request = transport.json('/kitchen/bootstrap', { signal: controller.signal, actorId: 'actor-a' });
  controller.abort(); await assert.rejects(request, error => error.name === 'AbortError');
  resolve({ data: { session } }); await Promise.resolve(); assert.equal(sent, false);
});
test('deadline covers body decoding and stalled session, independently of cooperative fetch cancellation', async () => {
  const body = createHttpTransport({ getSession: auth, defaultTimeoutMs: 5, fetcher: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) });
  await assert.rejects(body.json('/recipes'), error => error.status === 504);
  const identity = createHttpTransport({ getSession: () => new Promise(() => {}), defaultTimeoutMs: 5 });
  await assert.rejects(identity.json('/kitchen/bootstrap'), error => error.status === 504);
});
test('CAS and queue pressure preserve actionable status and bounded retry information', async () => {
  const cas = createHttpTransport({ getSession: auth, fetcher: async () => response({ message: 'internal' }, 409) });
  await assert.rejects(cas.json('/kitchen/session', { conflictMessage: 'Your draft is preserved; reload first.' }), error => error.status === 409 && /draft is preserved/.test(error.message));
  const queue = createHttpTransport({ getSession: auth, fetcher: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '9999' } }) });
  await assert.rejects(queue.json('/ai/search'), error => error.status === 429 && error.retryAfter === 180);
});
test('no actor response cache: consecutive requests use current auth and server response', async () => {
  let actor = 'actor-a'; const observed = [];
  const transport = createHttpTransport({ getSession: async () => ({ data: { session: { user: { id: actor }, access_token: actor } } }), fetcher: async (_url, opts) => { observed.push(opts.headers.get('Authorization')); return response({ owner: actor }); } });
  assert.equal((await transport.json('/account/profile')).owner, 'actor-a'); actor = 'actor-b';
  assert.equal((await transport.json('/account/profile')).owner, 'actor-b'); assert.deepEqual(observed, ['Bearer actor-a', 'Bearer actor-b']);
});
