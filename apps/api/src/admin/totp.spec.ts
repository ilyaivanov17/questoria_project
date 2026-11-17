import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildOtpAuthUrl,
  createTotpCode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from './totp.js';

test('TOTP code verifies within the adjacent time window', () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const code = createTotpCode(secret, now);
  assert.equal(verifyTotpCode(secret, code, now), true);
  assert.equal(verifyTotpCode(secret, code, now + 30_000), true);
  assert.equal(verifyTotpCode(secret, '000000', now), code !== '000000' ? false : true);
  assert.equal(verifyTotpCode(secret, 'not-code', now), false);
});

test('TOTP secrets are encrypted with authenticated encryption and produce otpauth URIs', () => {
  process.env.MFA_ENCRYPTION_KEY = 'a'.repeat(64);
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted), secret);
  assert.match(buildOtpAuthUrl('editor@example.test', secret), /^otpauth:\/\/totp\//);
});
