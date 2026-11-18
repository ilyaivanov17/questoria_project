import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSkillLearningTrend } from './learning-insights.js';

const outcomes = (values: boolean[]) => values.map((isCorrect) => ({ isCorrect }));

test('detects an improving result across two complete five-attempt windows', () => {
  const trend = calculateSkillLearningTrend(outcomes([
    true, true, true, true, false,
    true, false, false, false, false,
  ]));
  assert.deepEqual(trend, {
    direction: 'improving',
    recentAttempts: 5,
    recentSuccessful: 4,
    recentSuccessRate: 80,
    previousAttempts: 5,
    previousSuccessful: 1,
    previousSuccessRate: 20,
  });
});

test('detects a declining result across two complete five-attempt windows', () => {
  const trend = calculateSkillLearningTrend(outcomes([
    true, false, false, false, false,
    true, true, true, true, false,
  ]));
  assert.equal(trend.direction, 'declining');
  assert.equal(trend.recentSuccessRate, 20);
  assert.equal(trend.previousSuccessRate, 80);
});

test('keeps a small accuracy difference stable', () => {
  const trend = calculateSkillLearningTrend(outcomes([
    true, true, true, false, false,
    true, true, false, false, false,
  ]));
  assert.equal(trend.direction, 'stable');
  assert.equal(trend.recentSuccessRate, 60);
  assert.equal(trend.previousSuccessRate, 40);
});

test('does not label an incomplete sample as a trend', () => {
  const trend = calculateSkillLearningTrend(outcomes([
    true, true, false, true, false, true, true,
  ]));
  assert.equal(trend.direction, 'insufficient_data');
  assert.equal(trend.recentAttempts, 5);
  assert.equal(trend.recentSuccessRate, 60);
  assert.equal(trend.previousAttempts, 2);
  assert.equal(trend.previousSuccessRate, 100);
});

test('handles a skill with no learning evidence', () => {
  assert.deepEqual(calculateSkillLearningTrend([]), {
    direction: 'insufficient_data',
    recentAttempts: 0,
    recentSuccessful: 0,
    recentSuccessRate: null,
    previousAttempts: 0,
    previousSuccessful: 0,
    previousSuccessRate: null,
  });
});
