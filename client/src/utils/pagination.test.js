import test from 'node:test';
import assert from 'node:assert/strict';
import { paginationPages } from './pagination.js';

test('catalog windows retain first/current/last and neighbors at boundaries', () => {
  assert.deepEqual(paginationPages(1, 417), [1, 2, 3, 417]);
  assert.deepEqual(paginationPages(3, 417), [1, 2, 3, 4, 417]);
  assert.deepEqual(paginationPages(210, 417), [1, 209, 210, 211, 417]);
  assert.deepEqual(paginationPages(417, 417), [1, 415, 416, 417]);
  assert.deepEqual(paginationPages(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('very large totals stay bounded and malformed/empty totals do not allocate', () => {
  const total = Number.MAX_SAFE_INTEGER;
  const pages = paginationPages(total - 10, total);
  assert.equal(pages.length, 5);
  assert.deepEqual(pages, [1, total - 11, total - 10, total - 9, total]);
  for (const invalid of [0, -1, NaN, Infinity, 2.5, '417']) assert.deepEqual(paginationPages(1, invalid), []);
  assert.deepEqual(paginationPages(-1, 3), [1, 2, 3]);
  assert.deepEqual(paginationPages(99, 3), [1, 2, 3]);
});
