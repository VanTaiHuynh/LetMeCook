import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFailure, fetchWithRecovery, readJSON } from './requestFailure.js';

test('server failures keep internal worker and storage details out of the UI', () => {
  const error = requestFailure(503, 'Internal SQLSTATE and model path /private/models', 'Sunny');
  assert.equal(error.status, 503);
  assert.equal(error.message, 'Sunny is temporarily unavailable. Try again in a moment.');
});
test('validation errors and unsaved-edit conflict recovery remain actionable', () => {
  assert.equal(requestFailure(400, 'Confirm the ingredient names before searching.').message, 'Confirm the ingredient names before searching.');
  assert.equal(requestFailure(409, 'CAS revision mismatch', 'Planner', 'Your draft is intact. Load the saved week.').message, 'Your draft is intact. Load the saved week.');
  assert.equal(requestFailure(409, 'CAS revision mismatch').status, 409);
});
test('expired sessions, permissions, throttling and timeouts give recovery steps', () => {
  assert.match(requestFailure(401, 'invalid JWT').message, /Log in again/);
  assert.match(requestFailure(403, 'ACL').message, /do not have access/);
  assert.match(requestFailure(429, 'limit').message, /Wait a moment/);
  assert.match(requestFailure(504, 'worker timeout', 'Sunny').message, /took too long/);
});
test('network errors are readable and intentional cancellations remain cancellations', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(fetchWithRecovery('/test'), /Connection lost/);
    const aborted = new DOMException('Cancelled', 'AbortError');
    globalThis.fetch = async () => { throw aborted; };
    await assert.rejects(fetchWithRecovery('/test'), error => error === aborted);
  } finally { globalThis.fetch = original; }
});

test('cancelling after response headers preserves AbortError while malformed JSON is recoverable', async () => {
  const aborted = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(readJSON({ json: async () => { throw aborted; } }), error => error === aborted);
  assert.equal(await readJSON({ json: async () => { throw new SyntaxError('bad json'); } }), null);
  assert.deepEqual(await readJSON({ json: async () => ({ success: true }) }), { success: true });
});
