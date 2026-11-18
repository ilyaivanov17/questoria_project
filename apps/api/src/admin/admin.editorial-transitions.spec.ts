import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
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

function makeTransactionService(tx: unknown): AdminService {
  const prisma = {
    $transaction: async <T>(callback: (client: unknown) => Promise<T>) =>
      callback(tx),
  } as unknown as PrismaService;
  return new AdminService(prisma);
}

test('approval is a compare-and-set transition from REVIEW and writes one audit entry', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let auditCount = 0;
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
  };
  const service = makeTransactionService(tx);

  const result = await service.approveQuest(reviewer, 'quest-1');

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'REVIEW' });
  assert.equal(result && (result as { status: string }).status, 'APPROVED');
  assert.equal(auditCount, 1);
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

test('publication is a compare-and-set transition from APPROVED and is atomic with quest status and audit', async () => {
  let transitionQuery: Record<string, unknown> | undefined;
  let questUpdate: Record<string, unknown> | undefined;
  let auditCount = 0;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'APPROVED',
    authorId: 'author-1',
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    approvedById: 'reviewer-1',
  };
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
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeTransactionService(tx);

  const result = await service.publishQuest(publisher, 'quest-1');

  assert.deepEqual(transitionQuery?.where, { id: 'version-1', status: 'APPROVED' });
  assert.equal((transitionQuery?.data as { status: string }).status, 'PUBLISHED');
  assert.deepEqual(questUpdate?.data, { status: 'PUBLISHED' });
  assert.equal((result as { status: string }).status, 'PUBLISHED');
  assert.equal(auditCount, 1);
});

test('a stale publication is rejected without changing quest status or writing audit', async () => {
  let questUpdates = 0;
  let auditCount = 0;
  const version = {
    id: 'version-1',
    questId: 'quest-1',
    versionNo: 3,
    status: 'APPROVED',
    authorId: 'author-1',
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    approvedById: 'reviewer-1',
  };
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
