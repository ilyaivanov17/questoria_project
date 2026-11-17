import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
  MFA_RECOVERY_CODE_COUNT,
  normalizeMfaRecoveryCode,
} from './mfa-recovery.js';

test('generates ten unique high-entropy, printable one-time recovery codes', () => {
  const generated = generateMfaRecoveryCodes();

  assert.equal(generated.codes.length, MFA_RECOVERY_CODE_COUNT);
  assert.equal(generated.hashes.length, MFA_RECOVERY_CODE_COUNT);
  assert.equal(new Set(generated.codes).size, MFA_RECOVERY_CODE_COUNT);
  assert.equal(new Set(generated.hashes).size, MFA_RECOVERY_CODE_COUNT);

  for (const code of generated.codes) {
    assert.match(code, /^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$/);
    assert.match(hashMfaRecoveryCode(code), /^[a-f0-9]{64}$/);
  }
});

test('normalizes letter case and separators before hashing', () => {
  const code = 'A1B2C3-D4E5F6-123456-ABCDEF';

  assert.equal(normalizeMfaRecoveryCode(' a1b2c3 d4e5f6-123456-abcdef '), 'A1B2C3D4E5F6123456ABCDEF');
  assert.equal(
    hashMfaRecoveryCode(code),
    hashMfaRecoveryCode('a1b2c3 d4e5f6 123456 abcdef'),
  );
  assert.equal(normalizeMfaRecoveryCode('too-short'), null);
});
