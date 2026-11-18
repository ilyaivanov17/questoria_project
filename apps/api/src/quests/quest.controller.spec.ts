import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuestController } from './quest.controller.js';

function getThrottlerMetadata(handler: Function, kind: 'LIMIT' | 'TTL'): unknown {
  const key = Reflect.getMetadataKeys(handler).find(
    (candidate) => String(candidate).endsWith('THROTTLER:' + kind + 'default'),
  );
  assert.ok(key, 'expected default throttler ' + kind + ' metadata');
  return Reflect.getMetadata(key, handler);
}

test('guest demo answer submissions have a strict per-IP request limit', () => {
  assert.equal(getThrottlerMetadata(QuestController.prototype.submitGuestDemoAttempt, 'LIMIT'), 6);
  assert.equal(getThrottlerMetadata(QuestController.prototype.submitGuestDemoAttempt, 'TTL'), 60_000);
});
