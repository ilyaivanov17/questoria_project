import assert from 'node:assert/strict';
import test from 'node:test';
import { getPuzzleTypeCopy } from './play-utils.mjs';

test('all five supported puzzle types have distinct, actionable guidance', () => {
  const types = [
    'single_choice',
    'multiple_choice',
    'numeric_input',
    'text_input',
    'ordering',
  ];

  for (const type of types) {
    const copy = getPuzzleTypeCopy(type);
    assert.ok(copy.label.length > 0, type + ' label');
    assert.ok(copy.instruction.length > 20, type + ' instruction');
  }

  assert.notEqual(
    getPuzzleTypeCopy('single_choice').instruction,
    getPuzzleTypeCopy('multiple_choice').instruction,
  );
});

test('unknown puzzle types fail with explanatory copy, not empty labels', () => {
  const copy = getPuzzleTypeCopy('future_experimental_type');
  assert.equal(copy.label, 'НЕИЗВЕСТНЫЙ ФОРМАТ');
  assert.match(copy.instruction, /не поддерживается/i);
});
