import test from 'node:test';
import assert from 'node:assert/strict';
import { storedRecipeImagePath } from './recipeImage.js';

const storage = 'http://127.0.0.1:56421';
const web = 'http://localhost:9401';

test('uploaded recipe photos are signed only for the configured storage origin and bucket', () => {
  assert.equal(storedRecipeImagePath(`${storage}/storage/v1/object/public/recipe-images/user/photo%20one.webp`, storage, web), 'user/photo one.webp');
  assert.equal(storedRecipeImagePath('https://external.example/storage/v1/object/public/recipe-images/user/photo.webp', storage, web), null);
  assert.equal(storedRecipeImagePath(`${storage}/storage/v1/object/public/other-bucket/photo.webp`, storage, web), null);
  assert.equal(storedRecipeImagePath('/recipe-images/original.webp', storage, web), null);
});

test('missing and malformed photo paths do not become storage signing requests', () => {
  for (const src of [null, undefined, '', `${storage}/storage/v1/object/public/recipe-images/`, `${storage}/storage/v1/object/public/recipe-images/%ZZ`, `${storage}/storage/v1/object/public/recipe-images/%2E%2E%2Fprivate.webp`]) {
    assert.equal(storedRecipeImagePath(src, storage, web), null);
  }
});
