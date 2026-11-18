import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildQuestPuzzles,
  categorySeeds,
  questSeeds,
  skillSeeds,
  validateSeedLibrary,
} from './seed-content.js';
import { validatePuzzleAnswer } from './quests/puzzle-validator.js';

test('initial learning library has a complete, publishable catalog', () => {
  assert.deepEqual(validateSeedLibrary(), []);
  assert.equal(categorySeeds.length, 8);
  assert.equal(skillSeeds.length, 20);
  assert.equal(questSeeds.length, 21);
  assert.equal(
    questSeeds.reduce((total, quest) => total + buildQuestPuzzles(quest).length, 0),
    189,
  );
});

test('each seeded quest has three levels, varied tasks and explicit skill objectives', () => {
  for (const quest of questSeeds) {
    assert.equal(quest.levels.length, 3, quest.slug);
    assert.ok(quest.objectives.length >= 2 && quest.objectives.length <= 4, quest.slug);
    const puzzles = buildQuestPuzzles(quest);
    assert.equal(puzzles.length, 9, quest.slug);
    assert.ok(new Set(puzzles.map((puzzle) => puzzle.type)).size >= 2, quest.slug);
    for (const skillName of quest.skills) {
      assert.ok(
        quest.objectives.some((objective) => objective.includes(skillName)),
        quest.slug + ' must explicitly mention ' + skillName,
      );
    }
  }
});

test('all generated puzzle solutions are accepted by the gameplay validator', () => {
  for (const quest of questSeeds) {
    for (const puzzle of buildQuestPuzzles(quest)) {
      let answer: Record<string, unknown>;
      if (puzzle.type === 'single_choice') {
        answer = { optionId: puzzle.solutionPrivate.correctOptionId };
      } else if (puzzle.type === 'numeric_input') {
        answer = { value: puzzle.solutionPrivate.correctValue };
      } else {
        answer = { orderedIds: puzzle.solutionPrivate.correctOrderIds };
      }
      const result = validatePuzzleAnswer(
        puzzle.type,
        puzzle.publicPayload,
        puzzle.solutionPrivate,
        answer,
      );
      assert.equal(result.isCorrect, true, quest.slug + ' / puzzle ' + puzzle.orderNo);
    }
  }
});

test('first three starter quests have no prerequisite gate', () => {
  const prerequisites = new Map(skillSeeds.map((skill) => [skill.name, skill.prerequisites]));
  for (const quest of questSeeds.slice(0, 3)) {
    for (const skillName of quest.skills) {
      assert.deepEqual(prerequisites.get(skillName), [], quest.slug + ' / ' + skillName);
    }
  }
});
