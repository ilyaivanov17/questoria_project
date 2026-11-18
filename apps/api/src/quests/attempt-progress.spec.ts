import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getNextAvailablePuzzle,
  getResolvedPuzzleIds,
  isPuzzleResolved,
} from './attempt-progress.js';

const puzzles = [
  { id: 'first', maxAttempts: 3 },
  { id: 'second', maxAttempts: 2 },
  { id: 'third', maxAttempts: 3 },
];

test('a puzzle remains current while it has attempts remaining', () => {
  const attempts = [
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'first', isCorrect: false },
  ];

  assert.equal(getNextAvailablePuzzle(puzzles, attempts)?.id, 'first');
  assert.equal(isPuzzleResolved(puzzles[0]!, attempts), false);
});

test('an exhausted incorrect puzzle is resolved and does not block the next puzzle', () => {
  const attempts = [
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'second', isCorrect: false },
  ];

  assert.equal(isPuzzleResolved(puzzles[0]!, attempts), true);
  assert.equal(getNextAvailablePuzzle(puzzles, attempts)?.id, 'second');
});

test('a correct answer resolves a puzzle before its attempt limit', () => {
  const attempts = [
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'first', isCorrect: true },
  ];

  assert.equal(isPuzzleResolved(puzzles[0]!, attempts), true);
  assert.equal(getNextAvailablePuzzle(puzzles, attempts)?.id, 'second');
});

test('resolved progress includes solved and exhausted puzzles exactly once', () => {
  const attempts = [
    { puzzleId: 'first', isCorrect: false },
    { puzzleId: 'first', isCorrect: true },
    { puzzleId: 'second', isCorrect: false },
    { puzzleId: 'second', isCorrect: false },
  ];

  assert.deepEqual([...getResolvedPuzzleIds(puzzles, attempts)], ['first', 'second']);
  assert.equal(getNextAvailablePuzzle(puzzles, attempts)?.id, 'third');
});

test('an empty puzzle list has no next puzzle', () => {
  assert.equal(getNextAvailablePuzzle([], []), undefined);
});
