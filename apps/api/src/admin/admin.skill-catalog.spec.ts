import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AdminService } from './admin.service.js';

const actor = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  email: 'admin@example.test',
  nickname: 'Admin',
  roleKeys: ['ADMIN'],
  mfaEnabled: true,
  sessionMfaVerified: true,
} as AuthenticatedUser;

function makeService(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: async <T>(callback: (client: Record<string, unknown>) => Promise<T>) =>
      callback(tx),
  } as unknown as PrismaService;
  return new AdminService(prisma);
}

test('createSkill persists prerequisites and writes an audit record in the same transaction', async () => {
  const prerequisite = {
    id: '11111111-1111-4111-8111-111111111111',
    key: 'number-sense',
    name: 'Чувство числа',
    description: null,
    difficulty: 'beginner',
  };
  const created = {
    id: '22222222-2222-4222-8222-222222222222',
    key: 'fractions',
    name: 'Дроби',
    description: 'Понимание частей и долей.',
    difficulty: 'intermediate',
  };
  let createdEdges: Array<{ skillId: string; prerequisiteId: string }> = [];
  let auditCount = 0;
  const tx = {
    $queryRaw: async () => [],
    skill: {
      findMany: async () => [prerequisite],
      create: async () => created,
      findUnique: async () => ({
        ...created,
        prerequisites: [{ prerequisite }],
      }),
    },
    skillPrerequisite: {
      findMany: async () => [],
      createMany: async ({ data }: { data: Array<{ skillId: string; prerequisiteId: string }> }) => {
        createdEdges = data;
        return { count: data.length };
      },
    },
    adminAuditLog: {
      create: async () => { auditCount += 1; return {}; },
    },
  };
  const service = makeService(tx);

  const result = await service.createSkill(actor, {
    key: 'fractions',
    name: 'Дроби',
    description: 'Понимание частей и долей.',
    difficulty: 'intermediate',
    prerequisiteIds: [prerequisite.id],
  }) as {
    id: string;
    key: string;
    prerequisites: Array<{ id: string }>;
  };

  assert.equal(result.id, created.id);
  assert.equal(result.key, 'fractions');
  assert.deepEqual(result.prerequisites, [prerequisite]);
  assert.deepEqual(createdEdges, [{
    skillId: created.id,
    prerequisiteId: prerequisite.id,
  }]);
  assert.equal(auditCount, 1);
});

test('updateSkill rejects prerequisite cycles before changing edges or skill metadata', async () => {
  const skillId = '33333333-3333-4333-8333-333333333333';
  const prerequisiteA = '11111111-1111-4111-8111-111111111111';
  const prerequisiteB = '22222222-2222-4222-8222-222222222222';
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    skill: {
      findUnique: async () => ({
        id: skillId,
        key: 'advanced-reasoning',
        name: 'Продвинутое мышление',
        description: null,
        difficulty: 'advanced',
        prerequisites: [],
      }),
      findMany: async () => [{ id: prerequisiteA }],
      update: async () => { writes += 1; return {}; },
    },
    skillPrerequisite: {
      findMany: async () => [
        { skillId: prerequisiteA, prerequisiteId: prerequisiteB },
        { skillId: prerequisiteB, prerequisiteId: skillId },
      ],
      deleteMany: async () => { writes += 1; return { count: 0 }; },
      createMany: async () => { writes += 1; return { count: 1 }; },
    },
    adminAuditLog: {
      create: async () => { writes += 1; return {}; },
    },
  };
  const service = makeService(tx);

  await assert.rejects(
    () => service.updateSkill(actor, skillId, { prerequisiteIds: [prerequisiteA] }),
    (error: unknown) => error instanceof BadRequestException
      && String(error.message).includes('cycle'),
  );
  assert.equal(writes, 0);
});

test('updateSkill rejects unknown prerequisite IDs', async () => {
  const skillId = '33333333-3333-4333-8333-333333333333';
  const unknownId = '44444444-4444-4444-8444-444444444444';
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    skill: {
      findUnique: async () => ({
        id: skillId,
        key: 'advanced-reasoning',
        name: 'Продвинутое мышление',
        prerequisites: [],
      }),
      findMany: async () => [],
      update: async () => { writes += 1; return {}; },
    },
    skillPrerequisite: {
      findMany: async () => [],
      deleteMany: async () => { writes += 1; return { count: 0 }; },
      createMany: async () => { writes += 1; return { count: 1 }; },
    },
    adminAuditLog: {
      create: async () => { writes += 1; return {}; },
    },
  };
  const service = makeService(tx);

  await assert.rejects(
    () => service.updateSkill(actor, skillId, { prerequisiteIds: [unknownId] }),
    BadRequestException,
  );
  assert.equal(writes, 0);
});

test('updateSkill protects a skill name already referenced by quest versions', async () => {
  const skillId = '33333333-3333-4333-8333-333333333333';
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    skill: {
      findUnique: async () => ({
        id: skillId,
        key: 'critical-thinking',
        name: 'Критическое мышление',
        prerequisites: [],
      }),
      update: async () => { writes += 1; return {}; },
    },
    questVersion: {
      findFirst: async () => ({ id: '55555555-5555-4555-8555-555555555555' }),
    },
    skillPrerequisite: {
      findMany: async () => [],
    },
    adminAuditLog: {
      create: async () => { writes += 1; return {}; },
    },
  };
  const service = makeService(tx);

  await assert.rejects(
    () => service.updateSkill(actor, skillId, { name: 'Критическое мышление PRO' }),
    ConflictException,
  );
  assert.equal(writes, 0);
});

test('quest skill resolver accepts stable keys and legacy labels but rejects duplicate aliases', async () => {
  const skill = {
    id: '11111111-1111-4111-8111-111111111111',
    key: 'critical-thinking',
    name: 'Критическое мышление',
  };
  const tx = {
    skill: {
      findMany: async () => [skill],
    },
  };
  const service = makeService({});
  const resolver = (service as unknown as {
    resolveSkillNames: (client: typeof tx, values: string[]) => Promise<string[]>;
  }).resolveSkillNames.bind(service);

  assert.deepEqual(await resolver(tx, ['critical-thinking']), ['Критическое мышление']);
  assert.deepEqual(await resolver(tx, ['Критическое мышление']), ['Критическое мышление']);
  await assert.rejects(
    () => resolver(tx, ['critical-thinking', 'Критическое мышление']),
    BadRequestException,
  );
});
