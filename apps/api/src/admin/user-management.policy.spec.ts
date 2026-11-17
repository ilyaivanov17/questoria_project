import assert from 'node:assert/strict';
import test from 'node:test';
import { isSelfManagement, wouldRemoveLastActiveSuperAdmin } from './user-management.policy.js';

test('prevents a Super Admin from changing their own account roles or status', () => {
  assert.equal(isSelfManagement('user-1', 'user-1'), true);
  assert.equal(isSelfManagement('user-1', 'user-2'), false);
});

test('protects the last active Super Admin from removal or suspension', () => {
  assert.equal(wouldRemoveLastActiveSuperAdmin(['SUPER_ADMIN'], 'ACTIVE', 1), true);
  assert.equal(wouldRemoveLastActiveSuperAdmin(['ADMIN'], 'ACTIVE', 1), false);
  assert.equal(wouldRemoveLastActiveSuperAdmin(['SUPER_ADMIN'], 'SUSPENDED', 1), false);
  assert.equal(wouldRemoveLastActiveSuperAdmin(['SUPER_ADMIN'], 'ACTIVE', 2), false);
});
