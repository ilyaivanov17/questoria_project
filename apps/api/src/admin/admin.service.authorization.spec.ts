import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { UpdateQuestDto } from './dto/quest.dto.js';

const author: AuthenticatedUser = {
  userId: 'author-1',
  profileId: 'profile-1',
  sessionId: 'session-1',
  email: 'author@example.test',
  nickname: 'Author',
  roleKeys: ['AUTHOR'],
  mfaEnabled: false,
  sessionMfaVerified: false,
};

const reviewer: AuthenticatedUser = {
  ...author,
  userId: 'reviewer-1',
  roleKeys: ['REVIEWER'],
};

test('AUTHOR quest list and detail queries are scoped to versions authored by the current user', async () => {
  let listQuery: Record<string, unknown> | undefined;
  let detailQuery: Record<string, unknown> | undefined;
  const prisma = {
    quest: {
      findMany: async (query: Record<string, unknown>) => {
        listQuery = query;
        return [];
      },
      findFirst: async (query: Record<string, unknown>) => {
        detailQuery = query;
        return null;
      },
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await service.listQuests(author);
  await assert.rejects(
    () => service.getQuest(author, 'other-quest'),
    NotFoundException,
  );

  assert.deepEqual(listQuery?.where, {
    versions: { some: { authorId: author.userId } },
  });
  assert.deepEqual(
    (listQuery?.include as { versions: { where: unknown } }).versions.where,
    { authorId: author.userId },
  );
  assert.deepEqual(detailQuery?.where, {
    id: 'other-quest',
    versions: { some: { authorId: author.userId } },
  });
});

test('REVIEWER can inspect all quest versions for editorial review', async () => {
  let listQuery: Record<string, unknown> | undefined;
  const prisma = {
    quest: {
      findMany: async (query: Record<string, unknown>) => {
        listQuery = query;
        return [];
      },
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await service.listQuests(reviewer);
  assert.deepEqual(listQuery?.where, {});
  assert.deepEqual(
    (listQuery?.include as { versions: { where: unknown } }).versions.where,
    {},
  );
});

test('AUTHOR cannot edit another author\'s draft even when the route role permits quest updates', async () => {
  let transactionCalled = false;
  const prisma = {
    quest: { findUnique: async () => ({ id: 'quest-1' }) },
    questVersion: {
      findFirst: async () => ({ id: 'version-1', authorId: 'author-2' }),
    },
    $transaction: async () => {
      transactionCalled = true;
      throw new Error('transaction must not be started for a forbidden author');
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await assert.rejects(
    () => service.updateQuest(author, 'quest-1', {} as UpdateQuestDto),
    ForbiddenException,
  );
  assert.equal(transactionCalled, false);
});

test('AUTHOR cannot submit another author\'s draft for review', async () => {
  const prisma = {
    questVersion: {
      findFirst: async () => ({ id: 'version-1', authorId: 'author-2' }),
    },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);

  await assert.rejects(
    () => service.submitForReview(author, 'quest-1'),
    ForbiddenException,
  );
});
