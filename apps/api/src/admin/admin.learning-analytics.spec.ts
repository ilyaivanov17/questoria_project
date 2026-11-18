import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AdminService } from './admin.service.js';

function makeService(tx: Record<string, unknown>) {
  return new AdminService(tx as unknown as PrismaService);
}

test('learning analytics aggregates evidence, mastery and task quality signals by skill', async () => {
  const service = makeService({
    skill: {
      findMany: async () => [
        { id: 'skill-1', key: 'fractions', name: 'Дроби' },
        { id: 'skill-2', key: 'reasoning', name: 'Рассуждение' },
      ],
    },
    learningEvidence: {
      groupBy: async () => [
        { skillId: 'skill-1', taskType: 'numeric_input', isCorrect: true, _count: { _all: 8 } },
        { skillId: 'skill-1', taskType: 'numeric_input', isCorrect: false, _count: { _all: 4 } },
        { skillId: 'skill-1', taskType: 'ordering', isCorrect: true, _count: { _all: 2 } },
      ],
    },
    profileSkillProgress: {
      groupBy: async () => [
        { skillId: 'skill-1', status: 'MASTERED', _count: { _all: 3 } },
        { skillId: 'skill-1', status: 'DEVELOPING', _count: { _all: 2 } },
      ],
    },
  });
  const result = await service.getLearningAnalytics() as {
    totals: { evidence: number; successfulEvidence: number; successRate: number };
    skills: Array<{
      skillKey: string;
      evidence: { attempts: number; successful: number; successRate: number; taskTypeCount: number };
      mastery: { mastered: number; developing: number; masteryRate: number };
      qualitySignals: string[];
    }>;
  };

  assert.equal(result.totals.evidence, 14);
  assert.equal(result.totals.successfulEvidence, 10);
  assert.equal(result.totals.successRate, 71);
  assert.equal(result.skills[0].skillKey, 'fractions');
  assert.equal(result.skills[0].evidence.attempts, 14);
  assert.equal(result.skills[0].evidence.successful, 10);
  assert.equal(result.skills[0].evidence.successRate, 71);
  assert.equal(result.skills[0].evidence.taskTypeCount, 2);
  assert.equal(result.skills[0].mastery.mastered, 3);
  assert.equal(result.skills[0].mastery.developing, 2);
  assert.equal(result.skills[0].mastery.masteryRate, 60);
  assert.deepEqual(result.skills[0].qualitySignals, []);
  assert.deepEqual(result.skills[1].qualitySignals, []);
});

test('learning analytics flags insufficient sample size and low task diversity', async () => {
  const service = makeService({
    skill: { findMany: async () => [{ id: 'skill-1', key: 'logic', name: 'Логика' }] },
    learningEvidence: {
      groupBy: async () => [
        { skillId: 'skill-1', taskType: 'single_choice', isCorrect: true, _count: { _all: 4 } },
      ],
    },
    profileSkillProgress: { groupBy: async () => [] },
  });
  const result = await service.getLearningAnalytics() as {
    skills: Array<{ qualitySignals: string[]; evidence: { successRate: number | null } }>;
  };

  assert.deepEqual(result.skills[0].qualitySignals, ['LOW_SAMPLE_SIZE', 'LOW_TASK_DIVERSITY']);
  assert.equal(result.skills[0].evidence.successRate, 100);
});

test('learning analytics flags low success rate only after a meaningful sample', async () => {
  const service = makeService({
    skill: { findMany: async () => [{ id: 'skill-1', key: 'logic', name: 'Логика' }] },
    learningEvidence: {
      groupBy: async () => [
        { skillId: 'skill-1', taskType: 'single_choice', isCorrect: true, _count: { _all: 3 } },
        { skillId: 'skill-1', taskType: 'single_choice', isCorrect: false, _count: { _all: 8 } },
      ],
    },
    profileSkillProgress: { groupBy: async () => [] },
  });
  const result = await service.getLearningAnalytics() as {
    skills: Array<{ qualitySignals: string[]; evidence: { successRate: number } }>;
  };

  assert.deepEqual(result.skills[0].qualitySignals, ['LOW_SUCCESS_RATE', 'LOW_TASK_DIVERSITY']);
  assert.equal(result.skills[0].evidence.successRate, 27);
});
