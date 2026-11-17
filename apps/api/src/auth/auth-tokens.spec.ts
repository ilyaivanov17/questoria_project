import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpaqueToken, hashOpaqueToken } from './auth-tokens.js';

test('opaque account tokens are URL-safe, sufficiently random and stored as hashes', () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();

  assert.equal(first.token.length, 43);
  assert.match(first.token, /^[A-Za-z0-9_-]+$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.equal(hashOpaqueToken(first.token), first.tokenHash);
});
