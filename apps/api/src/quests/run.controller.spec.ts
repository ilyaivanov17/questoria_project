import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunController } from './run.controller.js';

function getThrottlerMetadata(handler: Function, kind: 'LIMIT' | 'TTL'): unknown {
  const key = Reflect.getMetadataKeys(handler).find(
    (candidate) => String(candidate).endsWith(`THROTTLER:${kind}:default`),
  );
  assert.ok(key, `expected default throttler ${kind} metadata`);
  return Reflect.getMetadata(key, handler);
}

test('starting runs has a stricter endpoint limit than the global API default', () => {
  assert.equal(getThrottlerMetadata(RunController.prototype.start, 'LIMIT'), 10);
  assert.equal(getThrottlerMetadata(RunController.prototype.start, 'TTL'), 60_000);
});

test('puzzle answer submissions are rate limited to 30 requests per minute', () => {
  assert.equal(getThrottlerMetadata(RunController.prototype.submitAttempt, 'LIMIT'), 30);
  assert.equal(getThrottlerMetadata(RunController.prototype.submitAttempt, 'TTL'), 60_000);
});
