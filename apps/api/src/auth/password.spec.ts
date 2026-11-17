import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from './password.js';

test('password hashes can be verified without storing plaintext', async () => {
  const password = 'questoria-strong-password-2026';
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('a-different-password-2026', encoded), false);
});

test('malformed password hashes are rejected safely', async () => {
  assert.equal(await verifyPassword('password', 'not-a-password-hash'), false);
});
