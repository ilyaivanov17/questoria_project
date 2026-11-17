import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebOrigin } from './web-origin.js';

test('uses an explicitly configured web origin', () => {
  assert.equal(
    getWebOrigin({ WEB_ORIGIN: 'https://questoria.example.com/path' }),
    'https://questoria.example.com',
  );
});

test('automatically detects the forwarded frontend URL in Codespaces', () => {
  assert.equal(
    getWebOrigin({
      CODESPACES: 'true',
      CODESPACE_NAME: 'curious-space',
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
      WEB_ORIGIN: 'http://localhost:3000',
    }),
    'https://curious-space-3000.app.github.dev',
  );
});

test('uses localhost outside Codespaces when no origin is configured', () => {
  assert.equal(getWebOrigin({}), 'http://localhost:3000');
});
