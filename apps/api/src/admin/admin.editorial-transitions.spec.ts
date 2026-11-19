import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

const reviewer: AuthenticatedUser = {
  userId: 'reviewer-1',
  profileId: 'profile-1',
  sessionId: 'session-1',
  email: 'reviewer@example.test',
  nickname: 'Reviewer',
  roleKeys: ['REVIEWER'],
  mfaEnabled: true,
  sessionMfaVerified: true,
};

const publisher: AuthenticatedUser = {
  ...reviewer,
  userId: 'admin-1',
  email: 'admin@example.test',
  roleKeys: ['ADMIN'],
};

const author: AuthenticatedUser = {
  ...reviewer,
  userId: 'author-1',
  email: 'author@example.test',
  roleKeys: ['AUTHOR'],
};

function makeTransactionService(tx: unknown): AdminService {
  const prisma = {
    $transaction: async <T>(callback: (client: unknown) => Promise<T>) =>
      callback(tx),
  } as unknown as PrismaService;
  return new AdminService(prisma);
}

function makePublishableApprovedVersion() {
  return {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'APPROVED',
    authorId: 'author-1',
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    approvedById: 'reviewer-1',
    title: 'Foundations of number patterns',
    summary: 'A practical introduction to recognizing and applying number patterns.',
    description: 'Explore repeating number patterns, identify relationships, and apply each rule to new examples.',
    objectives: ['Understand Number Patterns', 'Apply Number Patterns to new examples'],
    skills: ['Number Patterns'],
    ageMin: 14,
    ageMax: 99,
    locale: 'ru',
    difficulty: 'Начальный',
    durationMin: 10,
    seo: {
      title: 'Number patterns quest',
      description: 'Learn to recognize and apply number patterns in short interactive puzzles.',
    },
    coverUrl: 'https://example.test/number-patterns.png',
    coverAlt: 'Number patterns illustration',
    coverLicenseSource: 'https://example.test/license',
    quest: { category: { status: 'PUBLISHED' } },
    levels: [{
      orderNo: 1,
      title: 'Find the rule',
      intro: 'Look for the relationship between neighboring numbers.',
      puzzles: [
        {
          orderNo: 1,
          type: 'single_choice',
          publicPayload: { options: [{ id: 'double', label: 'Double the number' }] },
          solutionPrivate: { correctOptionId: 'double', correctFeedback: 'Correct: the number doubles.' },
          hints: [{ body: 'Compare each number with the next one.' }],
        },
        {
          orderNo: 2,
          type: 'numeric_input',
          publicPayload: { prompt: 'What comes after 32?' },
          solutionPrivate: { correctValue: 64, correctFeedback: 'Correct: 32 doubled is 64.' },
          hints: [{ body: 'Multiply 32 by two.' }],
        },
        {
          orderNo: 3,
          type: 'single_choice',
          publicPayload: { options: [{ id: 'even', label: 'All values are even' }] },
          solutionPrivate: { correctOptionId: 'even', correctFeedback: 'Correct: every value is even.' },
          hints: [{ body: 'Check whether each value is divisible by two.' }],
        },
      ],
    }],
  };
}

test('approval is a compare-and-set transition from REVIEW and writes one audit entry', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let auditCount = 0;
  let notificationInput: Record<string, unknown> | undefined;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'REVIEW',
    authorId: 'author-1',
  };
  const approved = { ...version, status: 'APPROVED', approvedById: reviewer.userId };
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async (query: Record<string, unknown>) => {
        transitionQuery = query;
        return { count: 1 };
      },
      findUnique: async () => approved,
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
    questEditorialNotification: {
      create: async (query: Record<string, unknown>) => { notificationInput = query; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.approveQuest(reviewer, 'quest-1');

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'REVIEW' });
  assert.equal(result && (result as { status: string }).status, 'APPROVED');
  assert.equal(auditCount, 1);
  assert.deepEqual(notificationInput?.data, {
    recipientId: 'author-1',
    questId: 'quest-1',
    questVersionId: 'version-1',
    type: 'APPROVED',
    message: 'Версия v3 одобрена и ожидает публикации.',
  });
});

test('a stale approval is rejected and produces no audit event', async () => {
  let auditCount = 0;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'REVIEW',
    authorId: 'author-1',
  };
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => { throw new Error('must not reload an untransitioned version'); },
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.approveQuest(reviewer, 'quest-1'),
    ConflictException,
  );
  assert.equal(auditCount, 0);
});

test('a reviewer can return a reviewed quest to its author with a required, audited comment', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let auditInput: Record<string, unknown> | undefined;
  let auditCount = 0;
  let notificationInput: Record<string, unknown> | undefined;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 2,
    status: 'REVIEW',
    authorId: author.userId,
  };
  const returned = {
    ...version,
    status: 'DRAFT',
    reviewerId: reviewer.userId,
    reviewFeedback: 'Please clarify the second learning objective.',
  };
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async (query: Record<string, unknown>) => {
        transitionQuery = query;
        return { count: 1 };
      },
      findUnique: async () => returned,
    },
    adminAuditLog: {
      create: async (query: Record<string, unknown>) => {
        auditCount += 1;
        auditInput = query;
        return {};
      },
    },
    questEditorialNotification: {
      create: async (query: Record<string, unknown>) => { notificationInput = query; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.requestQuestChanges(
    reviewer,
    'quest-1',
    '  Please clarify the second learning objective.  ',
  );

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'REVIEW' });
  assert.deepEqual(transitionQuery?.data, {
    status: 'DRAFT',
    reviewerId: reviewer.userId,
    reviewFeedback: 'Please clarify the second learning objective.',
    approvedAt: null,
    approvedById: null,
  });
  assert.deepEqual(result, {
    id: 'quest-1',
    versionId: 'version-1',
    versionNo: 2,
    status: 'DRAFT',
  });
  assert.equal(auditCount, 1);
  assert.equal((auditInput?.data as { action: string }).action, 'quest.returned_for_revision');
  assert.equal((auditInput?.data as { reason: string }).reason, 'Please clarify the second learning objective.');
  assert.deepEqual(notificationInput?.data, {
    recipientId: author.userId,
    questId: 'quest-1',
    questVersionId: 'version-1',
    type: 'CHANGES_REQUESTED',
    message: 'Please clarify the second learning objective.',
  });
});

test('an author cannot return their own version for revision', async () => {
  let transitionCount = 0;
  let auditCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1',
        questId: 'quest-1',
        versionNo: 2,
        status: 'REVIEW',
        authorId: author.userId,
      }),
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.requestQuestChanges(author, 'quest-1', 'Please improve the examples.'),
    ForbiddenException,
  );
  assert.equal(transitionCount, 0);
  assert.equal(auditCount, 0);
});

test('a review version without an assigned author cannot be returned', async () => {
  let transitionCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1',
        questId: 'quest-1',
        versionNo: 2,
        status: 'REVIEW',
        authorId: null,
      }),
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.requestQuestChanges(reviewer, 'quest-1', 'Please improve the examples.'),
    ConflictException,
  );
  assert.equal(transitionCount, 0);
});

test('a stale review return is rejected without an audit event', async () => {
  let auditCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1',
        questId: 'quest-1',
        versionNo: 2,
        status: 'REVIEW',
        authorId: author.userId,
      }),
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => { throw new Error('must not reload an untransitioned version'); },
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.requestQuestChanges(reviewer, 'quest-1', 'Please improve the examples.'),
    ConflictException,
  );
  assert.equal(auditCount, 0);
});

test('review feedback must be between 10 and 2000 characters', async () => {
  const service = makeTransactionService({});
  await assert.rejects(
    () => service.requestQuestChanges(reviewer, 'quest-1', 'Too short'),
    /between 10 and 2000 characters/,
  );
  await assert.rejects(
    () => service.requestQuestChanges(reviewer, 'quest-1', 'x'.repeat(2001)),
    /between 10 and 2000 characters/,
  );
});

test('publication is a compare-and-set transition from APPROVED and is atomic with quest status and audit', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let questUpdate: Record<string, unknown> | undefined;
  let auditCount = 0;
  let notificationInput: Record<string, unknown> | undefined;
  const version = makePublishableApprovedVersion();
  const published = { ...version, status: 'PUBLISHED', publishedById: publisher.userId };
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async (query: Record<string, unknown>) => {
        transitionQuery = query;
        return { count: 1 };
      },
      findUnique: async () => published,
    },
    quest: {
      findUnique: async () => ({ id: 'quest-1', category: { status: 'PUBLISHED' } }),
      update: async (query: Record<string, unknown>) => {
        questUpdate = query;
        return { id: 'quest-1', status: 'PUBLISHED' };
      },
    },
    skill: {
      findMany: async () => [{ id: 'skill-1', key: 'number-patterns', name: 'Number Patterns' }],
    },
    skillPrerequisite: { findMany: async () => [] },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
    questEditorialNotification: {
      create: async (query: Record<string, unknown>) => { notificationInput = query; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.publishQuest(publisher, 'quest-1');

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'APPROVED' });
  assert.equal((transitionQuery?.data as { status: string }).status, 'PUBLISHED');
  assert.deepEqual(questUpdate?.data, { status: 'PUBLISHED' });
  assert.equal((result as { status: string }).status, 'PUBLISHED');
  assert.equal(auditCount, 1);
  assert.deepEqual(notificationInput?.data, {
    recipientId: 'author-1',
    questId: 'quest-1',
    questVersionId: 'version-1',
    type: 'PUBLISHED',
    message: 'Версия v3 опубликована и доступна в каталоге.',
  });
});


test('draft editing re-checks ownership after locking and re-reading the current version', async () => {
  const original = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'DRAFT',
    authorId: 'author-1',
    ageMin: 14,
    ageMax: 99,
  };
  const reassigned = { ...original, authorId: 'author-2' };
  let txWrites = 0;
  const tx = {
    $queryRaw: async () => [{ id: 'version-1' }],
    questVersion: {
      findFirst: async () => reassigned,
      update: async () => { txWrites += 1; return {}; },
    },
    quest: {
      update: async () => { txWrites += 1; return {}; },
    },
  };
  const prisma = {
    quest: { findUnique: async () => ({ id: 'quest-1' }) },
    questVersion: {
      findFirst: async (query: { where?: { status?: string } }) => (
        query.where?.status ? original : { ageMin: 14, ageMax: 99 }
      ),
    },
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await assert.rejects(
    () => service.updateQuest(author, 'quest-1', {} as never),
    ForbiddenException,
  );
  assert.equal(txWrites, 0);
});

test('draft submission re-checks ownership after locking and re-reading the current version', async () => {
  const original = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'DRAFT',
    authorId: 'author-1',
  };
  const reassigned = { ...original, authorId: 'author-2' };
  let readCount = 0;
  let transitionCount = 0;
  let auditCount = 0;
  const tx = {
    $queryRaw: async () => [{ id: 'version-1' }],
    questVersion: {
      findFirst: async () => {
        readCount += 1;
        return readCount === 1 ? original : reassigned;
      },
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
      findUnique: async () => reassigned,
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.submitForReview(author, 'quest-1'),
    ForbiddenException,
  );
  assert.equal(transitionCount, 0);
  assert.equal(auditCount, 0);
});

test('a batch submits every ready draft and audits each quest', async () => {
  const readyDraft = (questId: string) => ({
    ...makePublishableApprovedVersion(),
    id: `version-${questId}`,
    questId,
    status: 'DRAFT',
    authorId: author.userId,
  });
  const versions = new Map([
    ['quest-1', readyDraft('quest-1')],
    ['quest-2', readyDraft('quest-2')],
  ]);
  const transitions: Record<string, unknown>[] = [];
  let auditCount = 0;
  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => [{ id: values[0] }],
    questVersion: {
      findFirst: async (query: { where: { questId: string } }) => versions.get(query.where.questId),
      updateMany: async (query: Record<string, unknown>) => {
        transitions.push(query);
        return { count: 1 };
      },
    },
    skill: {
      findMany: async () => [{ id: 'skill-1', key: 'number-patterns', name: 'Number Patterns' }],
    },
    skillPrerequisite: { findMany: async () => [] },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  const result = await service.bulkSubmitForReview(author, ['quest-2', 'quest-1']) as {
    success: boolean; submittedCount: number; blockedCount: number;
    items: Array<{ questId: string; ready: boolean; errors: string[] }>;
  };

  assert.equal(result.success, true);
  assert.equal(result.submittedCount, 2);
  assert.equal(result.blockedCount, 0);
  assert.deepEqual(result.items.map((item) => item.questId), ['quest-2', 'quest-1']);
  assert.ok(result.items.every((item) => item.ready && item.errors.length === 0));
  assert.equal(transitions.length, 2);
  assert.ok(transitions.every((query) => (
    (query.where as { status: string }).status === 'DRAFT'
      && (query.data as { status: string }).status === 'REVIEW'
  )));
  assert.equal(auditCount, 2);
});

test('a batch reports every readiness failure and changes no quest when one draft is invalid', async () => {
  const readyDraft = (questId: string) => ({
    ...makePublishableApprovedVersion(),
    id: `version-${questId}`,
    questId,
    status: 'DRAFT',
    authorId: author.userId,
  });
  const versions = new Map([
    ['quest-1', readyDraft('quest-1')],
    ['quest-2', { ...readyDraft('quest-2'), title: '' }],
  ]);
  let transitionCount = 0;
  let auditCount = 0;
  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => [{ id: values[0] }],
    questVersion: {
      findFirst: async (query: { where: { questId: string } }) => versions.get(query.where.questId),
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
    skill: {
      findMany: async () => [{ id: 'skill-1', key: 'number-patterns', name: 'Number Patterns' }],
    },
    skillPrerequisite: { findMany: async () => [] },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  const result = await service.bulkSubmitForReview(author, ['quest-1', 'quest-2']) as {
    success: boolean; submittedCount: number; blockedCount: number;
    items: Array<{ questId: string; ready: boolean; errors: string[] }>;
  };

  assert.equal(result.success, false);
  assert.equal(result.submittedCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.items[0]?.ready, true);
  assert.equal(result.items[1]?.ready, false);
  assert.ok(result.items[1]?.errors.includes('Title is required.'));
  assert.equal(transitionCount, 0);
  assert.equal(auditCount, 0);
});

test('a batch cannot submit another author’s draft', async () => {
  const version = {
    ...makePublishableApprovedVersion(),
    id: 'version-quest-1',
    questId: 'quest-1',
    status: 'DRAFT',
    authorId: 'different-author',
  };
  let transitionCount = 0;
  const tx = {
    $queryRaw: async () => [{ id: version.id }],
    questVersion: {
      findFirst: async () => version,
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.bulkSubmitForReview(author, ['quest-1']),
    ForbiddenException,
  );
  assert.equal(transitionCount, 0);
});

test('a stale publication is rejected without changing quest status or writing audit', async () => {
  let questUpdates = 0;
  let auditCount = 0;
  const version = makePublishableApprovedVersion();
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => { throw new Error('must not reload an untransitioned version'); },
    },
    quest: {
      findUnique: async () => ({ id: 'quest-1', category: { status: 'PUBLISHED' } }),
      update: async () => { questUpdates += 1; return {}; },
    },
    skill: {
      findMany: async () => [{ id: 'skill-1', key: 'number-patterns', name: 'Number Patterns' }],
    },
    skillPrerequisite: { findMany: async () => [] },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.publishQuest(publisher, 'quest-1'),
    ConflictException,
  );
  assert.equal(questUpdates, 0);
  assert.equal(auditCount, 0);
});


test('a reviewer can assign an active reviewer to a REVIEW version and the change is audited', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let auditInput: Record<string, unknown> | undefined;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 4,
    status: 'REVIEW',
    authorId: author.userId,
    reviewerId: null,
  };
  const targetReviewer = {
    id: 'reviewer-2',
    emailNormalized: 'reviewer2@example.test',
    profile: { nickname: 'Reviewer Two' },
  };
  const tx = {
    questVersion: {
      findFirst: async () => version,
      updateMany: async (query: Record<string, unknown>) => {
        transitionQuery = query;
        return { count: 1 };
      },
    },
    user: { findFirst: async () => targetReviewer },
    adminAuditLog: {
      create: async (query: Record<string, unknown>) => { auditInput = query; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.assignQuestReviewer(reviewer, 'quest-1', targetReviewer.id);

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'REVIEW' });
  assert.deepEqual(transitionQuery?.data, { reviewerId: targetReviewer.id });
  assert.deepEqual(result, {
    id: 'quest-1',
    versionId: 'version-1',
    versionNo: 4,
    status: 'REVIEW',
    reviewerId: targetReviewer.id,
    reviewer: { id: targetReviewer.id, email: targetReviewer.emailNormalized, nickname: 'Reviewer Two' },
    changed: true,
  });
  assert.equal((auditInput?.data as { action: string }).action, 'quest.reviewer.assigned');
  assert.equal((auditInput?.data as { afterJson: { reviewerId: string } }).afterJson.reviewerId, targetReviewer.id);
});

test('authors cannot assign reviewers', async () => {
  let transactionStarted = false;
  const service = makeTransactionService({
    $transaction: async () => { transactionStarted = true; },
  });

  await assert.rejects(
    () => service.assignQuestReviewer(author, 'quest-1', 'reviewer-2'),
    ForbiddenException,
  );
  assert.equal(transactionStarted, false);
});

test('a quest author cannot be assigned as its own reviewer', async () => {
  let transitionCount = 0;
  let auditCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1', questId: 'quest-1', versionNo: 4,
        status: 'REVIEW', authorId: author.userId, reviewerId: null,
      }),
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
    user: { findFirst: async () => ({
      id: author.userId, emailNormalized: author.email, profile: null,
    }) },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.assignQuestReviewer(reviewer, 'quest-1', author.userId),
    ConflictException,
  );
  assert.equal(transitionCount, 0);
  assert.equal(auditCount, 0);
});

test('an inactive user or user without a reviewer role cannot be assigned', async () => {
  let transitionCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1', questId: 'quest-1', versionNo: 4,
        status: 'REVIEW', authorId: author.userId, reviewerId: null,
      }),
      updateMany: async () => { transitionCount += 1; return { count: 1 }; },
    },
    user: { findFirst: async () => null },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.assignQuestReviewer(reviewer, 'quest-1', 'inactive-user'),
    BadRequestException,
  );
  assert.equal(transitionCount, 0);
});

test('a stale reviewer assignment is rejected without an audit event', async () => {
  let auditCount = 0;
  const tx = {
    questVersion: {
      findFirst: async () => ({
        id: 'version-1', questId: 'quest-1', versionNo: 4,
        status: 'REVIEW', authorId: author.userId, reviewerId: null,
      }),
      updateMany: async () => ({ count: 0 }),
    },
    user: { findFirst: async () => ({
      id: 'reviewer-2', emailNormalized: 'reviewer2@example.test', profile: null,
    }) },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.assignQuestReviewer(reviewer, 'quest-1', 'reviewer-2'),
    ConflictException,
  );
  assert.equal(auditCount, 0);
});


test('editorial notifications are listed only for the authenticated recipient', async () => {
  const queryFindMany: Record<string, unknown> = {};
  const queryCount: Record<string, unknown> = {};
  const items = [{ id: 'notification-1', type: 'APPROVED' }];
  const prisma = {
    questEditorialNotification: {
      findMany: async (query: Record<string, unknown>) => {
        Object.assign(queryFindMany, query);
        return items;
      },
      count: async (query: Record<string, unknown>) => {
        Object.assign(queryCount, query);
        return 2;
      },
    },
    $transaction: async <T>(operations: Promise<unknown>[]) => Promise.all(operations) as unknown as Promise<T>,
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  const result = await service.listEditorialNotifications(author);

  assert.deepEqual(queryFindMany.where, { recipientId: author.userId });
  assert.deepEqual(queryCount.where, { recipientId: author.userId, readAt: null });
  assert.deepEqual(result, { items, unreadCount: 2 });
});

test('marking a notification read is scoped to its recipient', async () => {
  let updateQuery: Record<string, unknown> | undefined;
  const prisma = {
    questEditorialNotification: {
      updateMany: async (query: Record<string, unknown>) => {
        updateQuery = query;
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  const result = await service.markEditorialNotificationRead(author, 'notification-1');

  assert.deepEqual(updateQuery?.where, {
    id: 'notification-1',
    recipientId: author.userId,
    readAt: null,
  });
  assert.deepEqual(result, { id: 'notification-1', read: true, changed: true });
});

test('marking another user notification as read returns not found', async () => {
  let lookupQuery: Record<string, unknown> | undefined;
  const prisma = {
    questEditorialNotification: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async (query: Record<string, unknown>) => {
        lookupQuery = query;
        return null;
      },
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await assert.rejects(
    () => service.markEditorialNotificationRead(author, 'notification-owned-by-someone-else'),
    /Notification not found/,
  );
  assert.deepEqual(lookupQuery?.where, {
    id: 'notification-owned-by-someone-else',
    recipientId: author.userId,
  });
});

test('mark all notifications as read affects only the authenticated recipient', async () => {
  let updateQuery: Record<string, unknown> | undefined;
  const prisma = {
    questEditorialNotification: {
      updateMany: async (query: Record<string, unknown>) => {
        updateQuery = query;
        return { count: 3 };
      },
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  const result = await service.markAllEditorialNotificationsRead(author);

  assert.deepEqual(updateQuery?.where, { recipientId: author.userId, readAt: null });
  assert.deepEqual(result, { updatedCount: 3 });
});


test('bulk reviewer assignment updates each selected REVIEW version and audits every changed quest', async () => {
  const versions = [
    {
      id: 'version-1', questId: 'quest-1', versionNo: 2,
      status: 'REVIEW', authorId: author.userId, reviewerId: null,
    },
    {
      id: 'version-2', questId: 'quest-2', versionNo: 5,
      status: 'REVIEW', authorId: 'author-2', reviewerId: 'reviewer-old',
    },
    {
      id: 'version-3', questId: 'quest-3', versionNo: 1,
      status: 'REVIEW', authorId: 'author-3', reviewerId: 'reviewer-2',
    },
  ];
  const targetReviewer = {
    id: 'reviewer-2',
    emailNormalized: 'reviewer2@example.test',
    profile: { nickname: 'Reviewer Two' },
  };
  const updateQueries: Record<string, unknown>[] = [];
  const auditEntries: Record<string, unknown>[] = [];
  const tx = {
    questVersion: {
      findMany: async () => versions,
      updateMany: async (query: Record<string, unknown>) => {
        updateQueries.push(query);
        return { count: 1 };
      },
    },
    user: { findFirst: async () => targetReviewer },
    adminAuditLog: {
      create: async (query: Record<string, unknown>) => {
        auditEntries.push(query);
        return {};
      },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.bulkAssignQuestReviewer(
    reviewer,
    ['quest-1', 'quest-2', 'quest-3'],
    targetReviewer.id,
  );

  assert.equal(updateQueries.length, 2);
  assert.deepEqual(updateQueries[0]?.where, { id: 'version-1', status: 'REVIEW', reviewerId: null });
  assert.deepEqual(updateQueries[1]?.where, { id: 'version-2', status: 'REVIEW', reviewerId: 'reviewer-old' });
  assert.equal(auditEntries.length, 2);
  assert.equal((auditEntries[0]?.data as { action: string }).action, 'quest.reviewer.bulk_assigned');
  assert.equal((auditEntries[1]?.data as { entityId: string }).entityId, 'quest-2');
  assert.deepEqual(result, {
    changedCount: 2,
    unchangedCount: 1,
    reviewer: {
      id: targetReviewer.id,
      email: targetReviewer.emailNormalized,
      nickname: 'Reviewer Two',
    },
    items: [
      { questId: 'quest-1', versionId: 'version-1', versionNo: 2, reviewerId: targetReviewer.id, changed: true },
      { questId: 'quest-2', versionId: 'version-2', versionNo: 5, reviewerId: targetReviewer.id, changed: true },
      { questId: 'quest-3', versionId: 'version-3', versionNo: 1, reviewerId: targetReviewer.id, changed: false },
    ],
  });
});

test('bulk reviewer assignment rejects authors before starting a transaction', async () => {
  let transactionStarted = false;
  const service = makeTransactionService({
    $transaction: async () => { transactionStarted = true; },
  });

  await assert.rejects(
    () => service.bulkAssignQuestReviewer(author, ['quest-1'], 'reviewer-2'),
    ForbiddenException,
  );
  assert.equal(transactionStarted, false);
});

test('bulk reviewer assignment rejects empty, oversized and duplicate selections', async () => {
  let transactionStarted = false;
  const service = makeTransactionService({
    $transaction: async () => { transactionStarted = true; },
  });

  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, [], 'reviewer-2'),
    BadRequestException,
  );
  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, Array.from({ length: 26 }, (_, i) => `quest-${i}`), 'reviewer-2'),
    BadRequestException,
  );
  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, ['quest-1', 'quest-1'], 'reviewer-2'),
    BadRequestException,
  );
  assert.equal(transactionStarted, false);
});

test('bulk reviewer assignment rejects a target reviewer who authored any selected quest', async () => {
  let updateCount = 0;
  let auditCount = 0;
  const tx = {
    questVersion: {
      findMany: async () => [{
        id: 'version-1', questId: 'quest-1', versionNo: 2,
        status: 'REVIEW', authorId: 'reviewer-2', reviewerId: null,
      }],
      updateMany: async () => { updateCount += 1; return { count: 1 }; },
    },
    user: { findFirst: async () => ({
      id: 'reviewer-2', emailNormalized: 'reviewer2@example.test', profile: null,
    }) },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, ['quest-1'], 'reviewer-2'),
    ConflictException,
  );
  assert.equal(updateCount, 0);
  assert.equal(auditCount, 0);
});

test('bulk reviewer assignment rejects the whole selection if a quest is no longer in REVIEW', async () => {
  let updateCount = 0;
  let auditCount = 0;
  const tx = {
    questVersion: {
      findMany: async () => [{
        id: 'version-1', questId: 'quest-1', versionNo: 2,
        status: 'REVIEW', authorId: author.userId, reviewerId: null,
      }],
      updateMany: async () => { updateCount += 1; return { count: 1 }; },
    },
    user: { findFirst: async () => ({
      id: 'reviewer-2', emailNormalized: 'reviewer2@example.test', profile: null,
    }) },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, ['quest-1', 'quest-2'], 'reviewer-2'),
    ConflictException,
  );
  assert.equal(updateCount, 0);
  assert.equal(auditCount, 0);
});

test('bulk reviewer assignment uses compare-and-set and writes no audit on a concurrent change', async () => {
  let auditCount = 0;
  const tx = {
    questVersion: {
      findMany: async () => [{
        id: 'version-1', questId: 'quest-1', versionNo: 2,
        status: 'REVIEW', authorId: author.userId, reviewerId: null,
      }],
      updateMany: async () => ({ count: 0 }),
    },
    user: { findFirst: async () => ({
      id: 'reviewer-2', emailNormalized: 'reviewer2@example.test', profile: null,
    }) },
    adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
  };
  const service = makeTransactionService(tx);

  await assert.rejects(
    () => service.bulkAssignQuestReviewer(reviewer, ['quest-1'], 'reviewer-2'),
    ConflictException,
  );
  assert.equal(auditCount, 0);
});
