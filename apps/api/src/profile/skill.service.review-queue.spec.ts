import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SkillService } from './skill.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-18T10:00:00.000Z');
const dayMs = 24 * 60 * 60 * 1000;

function createReviewQueueService() {
  const transactionOptions: Array<{ isolationLevel?: string }> = [];
  const groupByCalls: unknown[] = [];
  const tx = {
    skill: {
      findMany: async () => [
        {
          id: 'skill-1',
          key: 'critical-thinking',
          name: 'Критическое мышление',
          progress: [{ status: 'MASTERED' }],
          prerequisites: [],
        },
        {
          id: 'skill-2',
          key: 'logic-puzzles',
          name: 'Логические задачи',
          progress: [{ status: 'PRACTICING' }],
          prerequisites: [{ prerequisiteId: 'skill-3' }],
        },
        {
          id: 'skill-3',
          key: 'foundation',
          name: 'Основы',
          progress: [{ status: 'PRACTICING' }],
          prerequisites: [],
        },
      ],
    },
    learningEvidence: {
      groupBy: async (args: { where: { evidenceType?: string } }) => {
        groupByCalls.push(args);
        if (args.where.evidenceType === 'DELAYED_CHECK') {
          return [{ skillId: 'skill-1', _count: { _all: 1 } }];
        }
        return [
          { skillId: 'skill-1', _max: { occurredAt: new Date(now.getTime() - 2 * dayMs) } },
          { skillId: 'skill-2', _max: { occurredAt: new Date(now.getTime() - 3 * dayMs) } },
        ];
      },
    },
    questVersion: {
      findMany: async () => [
        {
          title: 'Логическая экспедиция',
          difficulty: 'beginner',
          durationMin: 8,
          skills: ['critical-thinking'],
          quest: { slug: 'critical-thinking-expedition' },
        },
        {
          title: 'Сложная логическая миссия',
          difficulty: 'advanced',
          durationMin: 12,
          skills: ['logic-puzzles'],
          quest: { slug: 'locked-logic-mission' },
        },
        {
          title: 'Другая миссия',
          difficulty: 'intermediate',
          durationMin: 10,
          skills: ['foundation'],
          quest: { slug: 'foundation-mission' },
        },
      ],
    },
  };
  const prisma = {
    $transaction: async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel?: string },
    ) => {
      transactionOptions.push(options);
      return callback(tx);
    },
  } as unknown as PrismaService;

  return {
    service: new SkillService(prisma),
    transactionOptions,
    groupByCalls,
  };
}

test('builds a delayed-review queue from successful evidence in one repeatable-read snapshot', async () => {
  const { service, transactionOptions, groupByCalls } = createReviewQueueService();

  const result = await service.getReviewQueue(profileId, now);

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(groupByCalls.length, 2);
  assert.deepEqual(result.summary, { dueCount: 1, upcomingCount: 1, totalCount: 2 });

  assert.deepEqual(result.items.map((item) => ({
    skillKey: item.skillKey,
    state: item.state,
    intervalDays: item.intervalDays,
    daysOverdue: item.daysOverdue,
    recommendedSlugs: item.recommendedQuests.map((quest) => quest.slug),
  })), [
    {
      skillKey: 'logic-puzzles',
      state: 'due',
      intervalDays: 1,
      daysOverdue: 2,
      recommendedSlugs: [],
    },
    {
      skillKey: 'critical-thinking',
      state: 'upcoming',
      intervalDays: 3,
      daysOverdue: 0,
      recommendedSlugs: ['critical-thinking-expedition'],
    },
  ]);
});
