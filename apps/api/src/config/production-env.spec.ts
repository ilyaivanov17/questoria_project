import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionEnvironment,
  validateProductionEnvironment,
} from './production-env.js';

const validProductionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://questoria:strong-password@db.example.net:5432/questoria?schema=public',
  WEB_ORIGIN: 'https://questoria.example.com',
  NEXT_PUBLIC_SITE_URL: 'https://questoria.example.com',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'Questoria <no-reply@questoria.example.com>',
  MFA_ENCRYPTION_KEY: 'a'.repeat(64),
};

test('does not impose production requirements outside production', () => {
  assert.deepEqual(validateProductionEnvironment({ NODE_ENV: 'development' }), []);
  assert.deepEqual(validateProductionEnvironment({ NODE_ENV: 'test' }), []);
});

test('accepts a complete production configuration', () => {
  assert.deepEqual(validateProductionEnvironment(validProductionEnvironment), []);
  assert.doesNotThrow(() => assertProductionEnvironment(validProductionEnvironment));
});

test('reports missing production settings together without echoing secret values', () => {
  const errors = validateProductionEnvironment({ NODE_ENV: 'production' });
  const message = errors.join('\n');

  assert.ok(errors.length >= 7);
  assert.match(message, /DATABASE_URL is required/);
  assert.match(message, /WEB_ORIGIN is required/);
  assert.match(message, /NEXT_PUBLIC_SITE_URL is required/);
  assert.match(message, /EMAIL_PROVIDER must be explicitly set to "resend"/);
  assert.match(message, /RESEND_API_KEY is required/);
  assert.match(message, /EMAIL_FROM must contain a valid sender/);
  assert.match(message, /MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key/);
  assert.doesNotMatch(message, /re_test_key|strong-password|a{10}/);
});

test('rejects local databases, non-HTTPS origins, malformed senders, and invalid MFA keys', () => {
  const errors = validateProductionEnvironment({
    ...validProductionEnvironment,
    DATABASE_URL: 'postgresql://questoria:password@localhost:5432/questoria',
    WEB_ORIGIN: 'http://questoria.example.com',
    NEXT_PUBLIC_SITE_URL: 'https://questoria.example.com/app',
    EMAIL_FROM: 'Questoria <not-an-email>',
    MFA_ENCRYPTION_KEY: 'not-a-key',
  }).join('\n');

  assert.match(errors, /DATABASE_URL must point to a non-local PostgreSQL host/);
  assert.match(errors, /WEB_ORIGIN must use HTTPS/);
  assert.match(errors, /NEXT_PUBLIC_SITE_URL must contain only the origin/);
  assert.match(errors, /EMAIL_FROM must contain a valid sender/);
  assert.match(errors, /MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key/);
});

test('fails startup with all discovered configuration errors', () => {
  assert.throws(
    () => assertProductionEnvironment({ NODE_ENV: 'production' }),
    /Production environment validation failed:[\s\S]*DATABASE_URL is required/,
  );
});
