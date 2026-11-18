import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AdminService } from './admin.service.js';

const skill = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'critical-thinking',
  name: 'Критическое мышление',
};

function puzzle(orderNo: number, type: 'single_choice' | 'numeric_input') {
  return {
    orderNo,
    type,
    maxAttempts: 2,
    maxScore: 10,
    publicPayload: type === 'single_choice'
      ? { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }
      : {},
    solutionPrivate: type === 'single_choice'
      ? { correctOptionId: 'a', correctFeedback: 'Правильное объяснение.' }
      : { correctValue: 5, correctFeedback: 'Правильное объяснение.' },
    hints: [{ body: 'Подсказка.' }],
  };
}

function readinessVersion(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Критическое мышление',
    summary: 'Практика анализа информации и аргументов.',
    description: 'Этот квест помогает развить навык анализа фактов и проверки аргументов.',
    objectives: ['Развить критическое мышление', 'Научиться проверять аргументы'],
    skills: [skill.name],
    ageMin: 14,
    ageMax: 18,
    locale: 'ru',
    difficulty: 'beginner',
    durationMin: 20,
    seo: { title: 'Критическое мышление', description: 'Практика анализа фактов и аргументов.' },
    coverUrl: 'https://example.test/cover.jpg',
    coverAlt: 'Иллюстрация квеста',
    coverLicenseSource: 'https://example.test/license',
    quest: { category: { status: 'PUBLISHED' } },
    levels: [{
      orderNo: 1,
      title: 'Анализ',
      intro: 'Изучим аргументы и факты.',
      puzzles: [puzzle(1, 'single_choice'), puzzle(2, 'numeric_input'), puzzle(3, 'single_choice')],
    }],
    ...overrides,
  };
}

function makeReadiness() {
  const prisma = {
    skill: { findMany: async () => [skill] },
    skillPrerequisite: { findMany: async () => edges },
  } as unknown as PrismaService;
  const service = new AdminService(prisma);
  return (service as unknown as {
    checkPublishReadiness: (
      version: unknown,
      client: unknown,
    ) => Promise<{ errors: string[] }>;
  }).checkPublishReadiness.bind(service);
}

test('publication readiness requires every selected skill to be explicitly represented in a learning objective', async () => {
  const check = makeReadiness();
  const result = await check(
    readinessVersion({ objectives: ['Решать практические задачи', 'Объяснять свой ответ'] }),
    {
      skill: { findMany: async () => [skill] },
      skillPrerequisite: { findMany: async () => [] },
    },
  );
  assert.ok(result.errors.some((error) => error.includes('Learning objective must explicitly cover skill')));
});

test('publication readiness requires three puzzles and two task types for each skill', async () => {
  const check = makeReadiness();
  const result = await check(
    readinessVersion({
      levels: [{
        orderNo: 1,
        title: 'Анализ',
        intro: 'Изучим аргументы и факты.',
        puzzles: [puzzle(1, 'single_choice'), puzzle(2, 'single_choice')],
      }],
    }),
    {
      skill: { findMany: async () => [skill] },
      skillPrerequisite: { findMany: async () => [] },
    },
  );
  assert.ok(result.errors.some((error) => error.includes('at least 3 distinct puzzles')));
  assert.ok(result.errors.some((error) => error.includes('at least 2 task types')));
});

test('publication readiness detects cycles in the transitive prerequisite chain', async () => {
  const secondSkill = {
    id: '22222222-2222-4222-8222-222222222222',
    key: 'argument-analysis',
    name: 'Анализ аргументов',
  };
  const edges = [
    { skillId: skill.id, prerequisiteId: secondSkill.id },
    { skillId: secondSkill.id, prerequisiteId: skill.id },
  ];
  const check = makeReadiness();
  const result = await check(readinessVersion(), {
    skill: { findMany: async () => [skill, secondSkill] },
    skillPrerequisite: { findMany: async () => edges },
  });
  assert.ok(result.errors.some((error) => error.includes('prerequisite chain contains a cycle')));
});

test('publication readiness accepts a fully linked and sufficiently varied quest', async () => {
  const check = makeReadiness();
  const result = await check(readinessVersion(), {
    skill: { findMany: async () => [skill] },
    skillPrerequisite: { findMany: async () => [] },
  });
  assert.deepEqual(result.errors, []);
});
