import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { buildPuzzleReview, validatePuzzleAnswer } from './puzzle-validator.js';

const publicOptions = {
  prompt: 'Выбери варианты',
  options: [
    { id: 'a', label: 'Первый' },
    { id: 'b', label: 'Второй' },
    { id: 'c', label: 'Третий' },
  ],
};
const feedback = {
  correctFeedback: 'Правильно.',
  incorrectFeedback: 'Попробуй ещё раз.',
};

test('single_choice checks the selected public option against the private key', () => {
  assert.equal(
    validatePuzzleAnswer(
      'single_choice',
      publicOptions,
      { ...feedback, correctOptionId: 'b' },
      { optionId: 'b' },
    ).isCorrect,
    true,
  );
  assert.equal(
    validatePuzzleAnswer(
      'single_choice',
      publicOptions,
      { correctOptionId: 'b' },
      { optionId: 'a' },
    ).isCorrect,
    false,
  );
});

test('multiple_choice compares the complete set independent of selection order', () => {
  const solution = { ...feedback, correctOptionIds: ['a', 'c'] };
  assert.equal(
    validatePuzzleAnswer('multiple_choice', publicOptions, solution, {
      optionIds: ['c', 'a'],
    }).isCorrect,
    true,
  );
  assert.equal(
    validatePuzzleAnswer('multiple_choice', publicOptions, solution, {
      optionIds: ['a'],
    }).isCorrect,
    false,
  );
  assert.throws(
    () => validatePuzzleAnswer('multiple_choice', publicOptions, solution, {
      optionIds: ['a', 'unknown'],
    }),
    BadRequestException,
  );
});

test('numeric_input supports decimal dots, decimal commas and configured tolerance', () => {
  assert.equal(
    validatePuzzleAnswer(
      'numeric_input',
      {},
      { ...feedback, correctValue: 12.5, tolerance: 0.1 },
      { value: '12.55' },
    ).isCorrect,
    true,
  );
  assert.equal(
    validatePuzzleAnswer(
      'numeric_input',
      {},
      { correctValue: 12.5 },
      { value: '12,5' },
    ).isCorrect,
    true,
  );
  assert.throws(
    () => validatePuzzleAnswer(
      'numeric_input',
      {},
      { correctValue: 12.5 },
      { value: 'Infinity' },
    ),
    BadRequestException,
  );
  assert.throws(
    () => validatePuzzleAnswer(
      'numeric_input',
      {},
      { correctValue: 12.5 },
      { value: '12,5.6' },
    ),
    BadRequestException,
  );
});

test('text_input normalizes case, whitespace, Unicode form and Russian ё', () => {
  assert.equal(
    validatePuzzleAnswer(
      'text_input',
      {},
      { ...feedback, acceptedAnswers: ['всё верно', 'правильно'] },
      { text: '  ВСЕ   ВЕРНО  ' },
    ).isCorrect,
    true,
  );
  assert.equal(
    validatePuzzleAnswer(
      'text_input',
      {},
      { acceptedAnswers: ['удвоение'] },
      { text: 'удвоение!' },
    ).isCorrect,
    false,
  );
});

test('ordering requires all items exactly once and in the private target order', () => {
  const payload = {
    items: [
      { id: 'one', label: '1' },
      { id: 'two', label: '2' },
      { id: 'three', label: '3' },
    ],
  };
  const solution = { ...feedback, correctOrderIds: ['one', 'two', 'three'] };
  assert.equal(
    validatePuzzleAnswer('ordering', payload, solution, {
      orderedIds: ['one', 'two', 'three'],
    }).isCorrect,
    true,
  );
  assert.equal(
    validatePuzzleAnswer('ordering', payload, solution, {
      orderedIds: ['three', 'two', 'one'],
    }).isCorrect,
    false,
  );
  assert.throws(
    () => validatePuzzleAnswer('ordering', payload, solution, {
      orderedIds: ['one', 'one', 'three'],
    }),
    BadRequestException,
  );
});

test('unknown puzzle types are rejected instead of silently accepted', () => {
  assert.throws(
    () => validatePuzzleAnswer('arbitrary_script', {}, {}, {}),
    BadRequestException,
  );
});

test('review exposes the configured solution only through the explicit review builder', () => {
  const explanation = 'Разбор правильного решения.';

  assert.deepEqual(
    buildPuzzleReview('single_choice', publicOptions, {
      correctOptionId: 'b',
      correctFeedback: explanation,
    }),
    { explanation, correctAnswer: { optionId: 'b' }, correctAnswerText: 'Второй' },
  );
  assert.deepEqual(
    buildPuzzleReview('multiple_choice', publicOptions, {
      correctOptionIds: ['a', 'c'],
      correctFeedback: explanation,
    }),
    { explanation, correctAnswer: { optionIds: ['a', 'c'] }, correctAnswerText: 'Первый, Третий' },
  );
  assert.deepEqual(
    buildPuzzleReview('numeric_input', { unit: 'см' }, {
      correctValue: 12.5,
      correctFeedback: explanation,
    }),
    { explanation, correctAnswer: { value: 12.5 }, correctAnswerText: '12.5 см' },
  );
  assert.deepEqual(
    buildPuzzleReview('text_input', {}, {
      acceptedAnswers: ['ответ', 'верный ответ'],
      correctFeedback: explanation,
    }),
    { explanation, correctAnswer: { acceptedAnswers: ['ответ', 'верный ответ'] }, correctAnswerText: 'ответ / верный ответ' },
  );
  assert.deepEqual(
    buildPuzzleReview('ordering', {
      items: [{ id: 'one', label: '1' }, { id: 'two', label: '2' }],
    }, {
      correctOrderIds: ['two', 'one'],
      correctFeedback: explanation,
    }),
    { explanation, correctAnswer: { orderedIds: ['two', 'one'] }, correctAnswerText: '2 → 1' },
  );
});

test('review rejects a malformed private answer instead of exposing a partial solution', () => {
  assert.throws(
    () => buildPuzzleReview('single_choice', publicOptions, {
      correctOptionId: 'private-option',
      correctFeedback: 'Разбор.',
    }),
    /correctOptionId must match a public option/,
  );
});
