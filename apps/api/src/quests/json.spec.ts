import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asJsonRecord, asOptionList } from './json.js';

test('asJsonRecord accepts objects and rejects arrays/null', () => {
  assert.deepEqual(asJsonRecord({ prompt: 'Choose' }), { prompt: 'Choose' });
  assert.deepEqual(asJsonRecord([]), {});
  assert.deepEqual(asJsonRecord(null), {});
});

test('asOptionList returns only well-formed options', () => {
  assert.deepEqual(
    asOptionList([
      { id: 'a', label: 'Option A' },
      { id: 12, label: 'Invalid ID' },
      { id: 'b', label: null },
      'invalid',
    ]),
    [{ id: 'a', label: 'Option A' }],
  );
});
