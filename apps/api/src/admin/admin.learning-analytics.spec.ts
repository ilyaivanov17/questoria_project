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
        { skillId: 'skill-1', taskType: 'numeric_input', evidenceType: 'INITIAL', isCorrect: true, _count: { _all: 8 } },
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
        { skillId: 'skill-1', taskType: 'single_choice', evidenceType: 'INITIAL', isCorrect: true, _count: { _all: 4 } },
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


test('task learning analytics aggregates per puzzle and skill and compares current mastery cohorts', async () => {
  const service = makeService({
    learningEvidence: {
      groupBy: async () => [
        { puzzleId: 'puzzle-1', skillId: 'skill-1', profileId: 'learner-mastered', taskType: 'numeric_input', evidenceType: 'INITIAL', isCorrect: true, _count: { _all: 6 } },
        { puzzleId: 'puzzle-1', skillId: 'skill-1', profileId: 'learner-not-mastered', taskType: 'numeric_input', evidenceType: 'PRACTICE', isCorrect: true, _count: { _all: 1 } },
        { puzzleId: 'puzzle-1', skillId: 'skill-1', profileId: 'learner-not-mastered', taskType: 'numeric_input', evidenceType: 'DELAYED_CHECK', isCorrect: false, _count: { _all: 5 } },
      ],
    },
    puzzle: {
      findMany: async () => [{
        id: 'puzzle-1', orderNo: 2, type: 'numeric_input',
        level: {
          orderNo: 1, title: 'Дроби',
          questVersion: { id: 'version-1', versionNo: 3, title: 'Основы дробей', quest: { slug: 'fractions' } },
        },
      }],
    },
    skill: { findMany: async () => [{ id: 'skill-1', key: 'fractions', name: 'Дроби' }] },
    profileSkillProgress: {
      findMany: async () => [{ profileId: 'learner-mastered', skillId: 'skill-1', status: 'MASTERED' }],
    },
  });
  const result = await service.getTaskLearningAnalytics() as {
    totals: { puzzleSkillPairs: number; attempts: number; learners: number; flagged: number };
    tasks: Array<{
      questSlug: string;
      skillKey: string;
      successRate: number;
      masteryDiscrimination: {
        mastered: { successRate: number };
        notMastered: { successRate: number };
        successRateGap: number;
      };
      qualitySignals: string[];
    }>;
  };

  assert.deepEqual(result.totals, { puzzleSkillPairs: 1, attempts: 12, learners: 2, flagged: 0 });
  assert.equal(result.tasks[0].questSlug, 'fractions');
  assert.equal(result.tasks[0].skillKey, 'fractions');
  assert.equal(result.tasks[0].successRate, 58);
  assert.equal(result.tasks[0].masteryDiscrimination.mastered.successRate, 100);
  assert.equal(result.tasks[0].masteryDiscrimination.notMastered.successRate, 17);
  assert.equal(result.tasks[0].masteryDiscrimination.successRateGap, 83);
  assert.deepEqual(result.tasks[0].qualitySignals, []);
});

test('task learning analytics flags small samples and low mastery separation without exposing learner IDs', async () => {
  const service = makeService({
    learningEvidence: {
      groupBy: async () => [
        { puzzleId: 'puzzle-1', skillId: 'skill-1', profileId: 'a', taskType: 'single_choice', evidenceType: 'INITIAL', isCorrect: true, _count: { _all: 5 } },
        { puzzleId: 'puzzle-1', skillId: 'skill-1', profileId: 'b', taskType: 'single_choice', evidenceType: 'INITIAL', isCorrect: true, _count: { _all: 5 } },
      ],
    },
    puzzle: { findMany: async () => [{ id: 'puzzle-1', orderNo: 1, type: 'single_choice', level: { orderNo: 1, title: 'Уровень', questVersion: { id: 'v', versionNo: 1, title: 'Квест', quest: { slug: 'quest' } } } }] },
    skill: { findMany: async () => [{ id: 'skill-1', key: 'logic', name: 'Логика' }] },
    profileSkillProgress: { findMany: async () => [{ profileId: 'a', skillId: 'skill-1', status: 'MASTERED' }] },
  });
  const result = await service.getTaskLearningAnalytics() as {
    tasks: Array<{ qualitySignals: string[]; masteryDiscrimination: { successRateGap: number | null } }>;
  };
  assert.deepEqual(result.tasks[0].qualitySignals, ['LOW_EVIDENCE_DIVERSITY', 'LOW_MASTERY_SEPARATION']);
  assert.equal(result.tasks[0].masteryDiscrimination.successRateGap, 0);
  assert.equal(JSON.stringify(result).includes('"profileId"'), false);
});

test('task learning analytics handles an empty evidence set', async () => {
  const service = makeService({
    learningEvidence: { groupBy: async () => [] },
    puzzle: { findMany: async () => [] },
    skill: { findMany: async () => [] },
    profileSkillProgress: { findMany: async () => [] },
  });
  const result = await service.getTaskLearningAnalytics() as {
    totals: { puzzleSkillPairs: number; attempts: number; learners: number; flagged: number };
    tasks: unknown[];
  };
  assert.deepEqual(result.totals, { puzzleSkillPairs: 0, attempts: 0, learners: 0, flagged: 0 });
  assert.deepEqual(result.tasks, []);
});
