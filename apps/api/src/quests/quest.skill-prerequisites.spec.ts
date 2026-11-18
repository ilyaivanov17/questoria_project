import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { QuestService } from './quest.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const questVersionId = '22222222-2222-4222-8222-222222222222';
const createdRunId = '33333333-3333-4333-8333-333333333333';

type SkillFixture = {
  id: string;
  key: string;
  name: string;
  prerequisites: Array<{ prerequisiteId: string }>;
  progress: Array<{ status: string }>;
};

function createService(options: {
  tags?: string[];
  skills?: SkillFixture[];
  existingRun?: { id: string } | null;
} = {}) {
  const events: string[] = [];
  let createCount = 0;
  const tx = {
    $queryRaw: async () => {
      events.push('catalog-shared-lock');
      return [];
    },
    skill: {
      findMany: async () => {
        events.push('load-skill-graph');
        return options.skills ?? [];
      },
    },
    questRun: {
      findFirst: async () => {
        events.push('find-active-run');
        return options.existingRun ?? null;
      },
      create: async () => {
        events.push('create-run');
        createCount += 1;
        return { id: createdRunId };
      },
    },
  };
  const prisma = {
    questVersion: {
      findFirst: async () => ({
        id: questVersionId,
        skills: options.tags ?? [],
      }),
    },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      events.push('start-run-transaction');
      return callback(tx);
    },
  } as unknown as PrismaService;

  const service = new QuestService(prisma);
  (service as unknown as {
    getRun: (ownerId: string, runId: string) => Promise<object>;
  }).getRun = async (ownerId, runId) => {
    events.push('load-run');
    return { profileId: ownerId, runId };
  };

  return { service, events, getCreateCount: () => createCount };
}

const masteredFoundation: SkillFixture = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  key: 'number-sense',
  name: 'Чувство числа',
  prerequisites: [],
  progress: [{ status: 'MASTERED' }],
};

const targetSkill: SkillFixture = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  key: 'fractions',
  name: 'Дроби',
  prerequisites: [{ prerequisiteId: masteredFoundation.id }],
  progress: [],
};

test('startRun creates a quest with no skill tags without reading the skill catalog', async () => {
  const { service, events, getCreateCount } = createService();

  const result = await service.startRun(profileId, { slug: 'published-quest' });

  assert.deepEqual(events, ['start-run-transaction', 'find-active-run', 'create-run', 'load-run']);
  assert.equal(getCreateCount(), 1);
  assert.deepEqual(result, { profileId, runId: createdRunId });
});

test('startRun allows a quest when all direct prerequisites are mastered', async () => {
  const { service, events, getCreateCount } = createService({
    tags: ['Дроби'],
    skills: [masteredFoundation, targetSkill],
  });

  await service.startRun(profileId, { slug: 'published-quest' });

  assert.deepEqual(events, [
    'start-run-transaction',
    'find-active-run',
    'catalog-shared-lock',
    'load-skill-graph',
    'create-run',
    'load-run',
  ]);
  assert.equal(getCreateCount(), 1);
});

test('startRun blocks a new run and returns the unmet direct prerequisite', async () => {
  const practicingFoundation = { ...masteredFoundation, progress: [{ status: 'PRACTICING' }] };
  const { service, events, getCreateCount } = createService({
    tags: ['Дроби'],
    skills: [practicingFoundation, targetSkill],
  });

  await assert.rejects(
    () => service.startRun(profileId, { slug: 'published-quest' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        statusCode: 409,
        code: 'SKILL_PREREQUISITES_NOT_MET',
        message: 'Master the required skills before starting this quest.',
        unmetPrerequisites: [{
          id: masteredFoundation.id,
          key: 'number-sense',
          name: 'Чувство числа',
          status: 'practicing',
          mastered: false,
        }],
      });
      return true;
    },
  );

  assert.equal(getCreateCount(), 0);
  assert.equal(events.includes('create-run'), false);
});

test('startRun evaluates the full transitive prerequisite chain', async () => {
  const root = {
    ...masteredFoundation,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    key: 'basic-arithmetic',
    name: 'Основы арифметики',
    progress: [],
  };
  const middle = {
    ...masteredFoundation,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    key: 'number-sense',
    name: 'Чувство числа',
    prerequisites: [{ prerequisiteId: root.id }],
    progress: [{ status: 'MASTERED' }],
  };
  const target = {
    ...targetSkill,
    prerequisites: [{ prerequisiteId: middle.id }],
  };
  const { service, getCreateCount } = createService({
    tags: ['Дроби'],
    skills: [root, middle, target],
  });

  await assert.rejects(
    () => service.startRun(profileId, { slug: 'published-quest' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = error.getResponse() as {
        code: string;
        unmetPrerequisites: Array<{ key: string }>;
      };
      assert.equal(response.code, 'SKILL_PREREQUISITES_NOT_MET');
      assert.deepEqual(response.unmetPrerequisites.map((item) => item.key), ['basic-arithmetic']);
      return true;
    },
  );
  assert.equal(getCreateCount(), 0);
});

test('startRun keeps an existing active run resumable after prerequisites change', async () => {
  const activeRun = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
  const { service, events, getCreateCount } = createService({
    tags: ['Дроби'],
    existingRun: activeRun,
    skills: [],
  });

  const result = await service.startRun(profileId, { slug: 'published-quest' });

  assert.deepEqual(events, ['start-run-transaction', 'find-active-run', 'load-run']);
  assert.equal(getCreateCount(), 0);
  assert.deepEqual(result, { profileId, runId: activeRun.id });
});

test('startRun fails closed when a published quest skill is absent from the catalog', async () => {
  const { service, getCreateCount } = createService({
    tags: ['Несуществующий навык'],
    skills: [],
  });

  await assert.rejects(
    () => service.startRun(profileId, { slug: 'published-quest' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        statusCode: 409,
        code: 'SKILL_CATALOG_INCOMPLETE',
        message: 'Published quest skills must resolve to exactly one catalog entry.',
        missingSkills: ['Несуществующий навык'],
        ambiguousSkills: [],
      });
      return true;
    },
  );
  assert.equal(getCreateCount(), 0);
});

test('startRun rejects a malformed prerequisite cycle without recursing indefinitely', async () => {
  const first = {
    ...masteredFoundation,
    prerequisites: [{ prerequisiteId: targetSkill.id }],
  };
  const { service, getCreateCount } = createService({
    tags: ['Дроби'],
    skills: [first, targetSkill],
  });

  await assert.rejects(
    () => service.startRun(profileId, { slug: 'published-quest' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = error.getResponse() as { code: string };
      assert.equal(response.code, 'SKILL_PREREQUISITE_GRAPH_INVALID');
      return true;
    },
  );
  assert.equal(getCreateCount(), 0);
});
