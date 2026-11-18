import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canManageQuestDraft,
  canViewAllQuestVersions,
} from './cms-authorization.js';

const author = { userId: 'author-1', roleKeys: ['AUTHOR'] };
const anotherAuthor = { userId: 'author-2', roleKeys: ['AUTHOR'] };
const reviewer = { userId: 'reviewer-1', roleKeys: ['REVIEWER'] };
const admin = { userId: 'admin-1', roleKeys: ['ADMIN'] };
const superAdmin = { userId: 'super-1', roleKeys: ['SUPER_ADMIN'] };

test('authors can view all versions only when they also hold a review or admin role', () => {
  assert.equal(canViewAllQuestVersions(author), false);
  assert.equal(canViewAllQuestVersions({ ...author, roleKeys: ['AUTHOR', 'REVIEWER'] }), true);
});

test('an author can manage their own draft but not another author draft', () => {
  assert.equal(canManageQuestDraft(author, 'author-1'), true);
  assert.equal(canManageQuestDraft(author, 'author-2'), false);
  assert.equal(canManageQuestDraft(author, null), false);
});

test('reviewers can inspect all editorial versions but cannot take over author drafts', () => {
  assert.equal(canViewAllQuestVersions(reviewer), true);
  assert.equal(canManageQuestDraft(reviewer, 'author-2'), false);
  assert.equal(canManageQuestDraft(reviewer, 'reviewer-1'), true);
});

test('admins and super admins can manage drafts regardless of their author', () => {
  for (const actor of [admin, superAdmin]) {
    assert.equal(canViewAllQuestVersions(actor), true);
    assert.equal(canManageQuestDraft(actor, 'author-1'), true);
    assert.equal(canManageQuestDraft(actor, null), true);
  }
});
