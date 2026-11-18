import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SkillService } from './skill.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-18T10:00:00.000Z');

function createService() {
  const transactionOptions: Array<{ isolationLevel?: string }> = [];
  const tx = {
    skill: {
      findMany: async () => [
        {
          id: 'skill-1',
          key: 'critical-thinking',
          name: 'Критическое мышление',
          description: 'Проверяй утверждения и находи закономерности.',
          difficulty: 'intermediate',
          prerequisites: [],
          progress: [{
            status: 'MASTERED',
            attemptsCount: 7,
            successfulAttempts: 5,
            distinctPuzzles: 4,
            distinctQuestVersions: 2,
            distinctQuests: 2,
            distinctRuns: 3,
            distinctTaskTypes: 3,
            firstPracticedAt: new Date('2026-11-15T10:00:00.000Z'),
            lastPracticedAt: now,
            masteredAt: now,
          }],
        },
        {
          id: 'skill-2',
          key: 'number-patterns',
          name: 'Числовые закономерности',
          description: null,
          difficulty: 'beginner',
          prerequisites: [{
            prerequisite: {
              id: 'skill-1',
              key: 'critical-thinking',
              name: 'Критическое мышление',
              progress: [{ status: 'MASTERED' }],
            },
          }],
          progress: [],
        },
        {
          id: 'skill-3',
          key: 'logic-puzzles',
          name: 'Логические задачи',
          description: null,
          difficulty: null,
          prerequisites: [{
            prerequisite: {
              id: 'skill-2',
              key: 'number-patterns',
              name: 'Числовые закономерности',
              progress: [],
            },
          }],
          progress: [],
        },
      ],
    },
    questVersion: {
      findMany: async () => [
        {
          title: 'Продвинутые числовые закономерности',
          difficulty: 'advanced',
          durationMin: 12,
          skills: ['number-patterns'],
          quest: { slug: 'number-patterns-advanced' },
        },
        {
          title: 'Основы числовых закономерностей',
          difficulty: 'beginner',
          durationMin: 7,
          skills: ['Числовые закономерности'],
          quest: { slug: 'number-patterns-basics' },
        },
        {
          title: 'Логические задачи',
          difficulty: 'beginner',
          durationMin: 10,
          skills: ['logic-puzzles'],
          quest: { slug: 'logic-puzzles' },
        },
      ],
    },
    learningEvidence: {
      findMany: async () => [{
        id: 'evidence-1',
        taskType: 'ordering',
        evidenceType: 'TRANSFER',
        isCorrect: true,
        score: 10,
        occurredAt: now,
        skill: { key: 'critical-thinking', name: 'Критическое мышление' },
        questVersion: {
          title: 'Логическая миссия',
          quest: { slug: 'logic-mission' },
        },
        puzzle: {
          orderNo: 2,
          level: { title: 'Найди закономерность' },
        },
      }],
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
  return { service: new SkillService(prisma), transactionOptions };
}

test('returns mastery, evidence counts and a separate not-started state from one snapshot', async () => {
  const { service, transactionOptions } = createService();

  const result = await service.getSkills(profileId);

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.deepEqual(result.summary, {
    totalSkills: 3,
    practicedSkills: 1,
    masteredSkills: 1,
  });
  assert.deepEqual(result.skills[0], {
    id: 'skill-1',
    key: 'critical-thinking',
    name: 'Критическое мышление',
    description: 'Проверяй утверждения и находи закономерности.',
    difficulty: 'intermediate',
    status: 'mastered',
    available: true,
    prerequisites: [],
    attemptsCount: 7,
    successfulAttempts: 5,
    distinctPuzzles: 4,
    distinctQuestVersions: 2,
    distinctQuests: 2,
    distinctRuns: 3,
    distinctTaskTypes: 3,
    firstPracticedAt: '2026-11-15T10:00:00.000Z',
    lastPracticedAt: now.toISOString(),
    masteredAt: now.toISOString(),
    recommendedQuests: [],
  });
  assert.deepEqual(result.skills[1], {
    id: 'skill-2',
    key: 'number-patterns',
    name: 'Числовые закономерности',
    description: null,
    difficulty: 'beginner',
    status: 'not_started',
    available: true,
    prerequisites: [{
      id: 'skill-1',
      key: 'critical-thinking',
      name: 'Критическое мышление',
      status: 'mastered',
      mastered: true,
    }],
    attemptsCount: 0,
    successfulAttempts: 0,
    distinctPuzzles: 0,
    distinctQuestVersions: 0,
    distinctQuests: 0,
    distinctRuns: 0,
    distinctTaskTypes: 0,
    firstPracticedAt: null,
    lastPracticedAt: null,
    masteredAt: null,
    recommendedQuests: [{
      slug: 'number-patterns-basics',
      title: 'Основы числовых закономерностей',
      difficulty: 'beginner',
      durationMin: 7,
    }, {
      slug: 'number-patterns-advanced',
      title: 'Продвинутые числовые закономерности',
      difficulty: 'advanced',
      durationMin: 12,
    }],
  });
  assert.deepEqual(result.skills[2], {
    id: 'skill-3',
    key: 'logic-puzzles',
    name: 'Логические задачи',
    description: null,
    difficulty: null,
    status: 'not_started',
    available: false,
    prerequisites: [{
      id: 'skill-2',
      key: 'number-patterns',
      name: 'Числовые закономерности',
      status: 'not_started',
      mastered: false,
    }],
    attemptsCount: 0,
    successfulAttempts: 0,
    distinctPuzzles: 0,
    distinctQuestVersions: 0,
    distinctQuests: 0,
    distinctRuns: 0,
    distinctTaskTypes: 0,
    firstPracticedAt: null,
    lastPracticedAt: null,
    masteredAt: null,
    recommendedQuests: [],
  });
  assert.deepEqual(result.recentEvidence, [{
    id: 'evidence-1',
    skillKey: 'critical-thinking',
    skillName: 'Критическое мышление',
    taskType: 'ordering',
    evidenceType: 'transfer',
    isCorrect: true,
    score: 10,
    occurredAt: now.toISOString(),
    questTitle: 'Логическая миссия',
    questSlug: 'logic-mission',
    levelTitle: 'Найди закономерность',
    puzzleOrder: 2,
  }]);
});
