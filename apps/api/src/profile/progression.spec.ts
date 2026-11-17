import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlayerProgression } from './progression.js';

test('starts at level one with an empty XP bar', () => {
  const result = getPlayerProgression(0, { completedQuests: 0, completedRuns: 0, completedLevels: 0 });
  assert.equal(result.level, 1);
  assert.equal(result.xpToNextLevel, 100);
  assert.equal(result.progressPercent, 0);
  assert.equal(result.unlockedAchievements, 0);
});

test('calculates level progress and unlocks thresholds from server stats', () => {
  const result = getPlayerProgression(150, { completedQuests: 1, completedRuns: 2, completedLevels: 5 });
  assert.equal(result.level, 2);
  assert.equal(result.xpIntoLevel, 50);
  assert.equal(result.xpForNextLevel, 200);
  assert.equal(result.xpToNextLevel, 150);
  assert.equal(result.progressPercent, 25);
  assert.equal(result.achievements.find((item) => item.id === 'first-quest')?.unlocked, true);
  assert.equal(result.achievements.find((item) => item.id === 'five-levels')?.unlocked, true);
  assert.equal(result.achievements.find((item) => item.id === 'hundred-xp')?.unlocked, true);
});

test('unlocks the full achievement set at its thresholds', () => {
  const result = getPlayerProgression(620, { completedQuests: 3, completedRuns: 10, completedLevels: 5 });
  assert.equal(result.level, 4);
  assert.equal(result.unlockedAchievements, 5);
});
