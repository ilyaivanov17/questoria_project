import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequestId } from './request-context.js';

test('preserves a safe request ID for cross-service correlation', () => {
  assert.equal(resolveRequestId('questoria-smoke-0001'), 'questoria-smoke-0001');
});

test('generates a UUID when the request ID is missing or unsafe', () => {
  for (const value of [undefined, 'contains spaces', 'bad\\nheader', 'x'.repeat(65), ['duplicate-a', 'duplicate-b']]) {
    const requestId = resolveRequestId(value);
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
});

test('rejects request IDs that are too short', () => {
  const requestId = resolveRequestId('short');
  assert.notEqual(requestId, 'short');
  assert.match(requestId, /^[0-9a-f-]{36}$/i);
});
