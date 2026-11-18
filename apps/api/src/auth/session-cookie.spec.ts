import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';

const validToken = 'A'.repeat(43);

test('reads a valid session cookie among other cookies', () => {
  assert.equal(
    parseSessionCookie('theme=dark; ' + SESSION_COOKIE_NAME + '=' + validToken + '; locale=ru'),
    validToken,
  );
});

test('returns null when the session cookie is absent', () => {
  assert.equal(parseSessionCookie('theme=dark; locale=ru'), null);
  assert.equal(parseSessionCookie(undefined), null);
});

test('rejects malformed percent-encoding without throwing', () => {
  assert.doesNotThrow(() => parseSessionCookie(SESSION_COOKIE_NAME + '=%E0%A4%A'));
  assert.equal(parseSessionCookie(SESSION_COOKIE_NAME + '=%E0%A4%A'), null);
});

test('rejects duplicate or malformed session cookies', () => {
  assert.equal(parseSessionCookie(SESSION_COOKIE_NAME + '=' + validToken + '; ' + SESSION_COOKIE_NAME + '=' + validToken), null);
  assert.equal(parseSessionCookie(SESSION_COOKIE_NAME + '=short'), null);
  assert.equal(parseSessionCookie(SESSION_COOKIE_NAME + '=' + 'x'.repeat(257)), null);
  assert.equal(parseSessionCookie(SESSION_COOKIE_NAME + '=token.with.dots'), null);
});

test('rejects oversized cookie headers', () => {
  assert.equal(parseSessionCookie('x=' + 'a'.repeat(8_200)), null);
});
