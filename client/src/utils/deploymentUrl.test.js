import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSupabaseUrl, remapSupabaseStorageUrl } from './deploymentUrl.js';

const local = 'http://127.0.0.1:56421';
const site = 'https://letmecook.ca';

test('public and www browsers use their HTTPS origin, while local browsing remains local', () => {
  assert.equal(browserSupabaseUrl(local, site, site), site);
  assert.equal(browserSupabaseUrl(local, site, 'https://www.letmecook.ca'), 'https://www.letmecook.ca');
  for (const page of ['http://localhost:9401', 'http://127.0.0.1:9401', 'http://letmecook.ca', 'https://letmecook.ca:9443', 'https://elsewhere.example', 'https://letmecook.ca.evil.example']) {
    assert.equal(browserSupabaseUrl(local, site, page), local);
  }
});

test('unset, malformed and non-origin public configuration keeps the local gateway', () => {
  for (const config of ['', 'invalid', 'http://letmecook.ca', 'https://user@letmecook.ca', 'https://letmecook.ca/path', 'https://letmecook.ca?test=1']) {
    assert.equal(browserSupabaseUrl(local + '/', config, site), local);
  }
});

test('existing public storage objects resolve through the public gateway without data changes', () => {
  const path = '/storage/v1/object/public/user-profile-images/user/photo.webp';
  assert.equal(remapSupabaseStorageUrl(local + path, local, site), site + path);
  assert.equal(remapSupabaseStorageUrl(local + path, local, local), local + path);
  const recipe = '/storage/v1/object/public/recipe-images/user/photo%20one.webp';
  assert.equal(remapSupabaseStorageUrl(local + recipe, local, site), site + recipe);
});

test('unknown origins, signed URLs, source images and malformed values are not remapped', () => {
  for (const value of [undefined, null, '', '/recipe-images/source.jpg', 'https://external.example/storage/v1/object/public/recipe-images/user/a.jpg', local + '/storage/v1/object/sign/recipe-images/user/a.jpg?token=private', 'http://user@127.0.0.1:56421/storage/v1/object/public/recipe-images/a.jpg']) {
    assert.equal(remapSupabaseStorageUrl(value, local, site), value);
  }
});
