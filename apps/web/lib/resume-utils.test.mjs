import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectActiveRuns } from './resume-utils.mjs';

function run(id, status, lastActivityAt, overrides = {}) {
  return {
    id,
    title: 'Миссия ' + id,
    status,
    completedLevels: 1,
    score: 20,
    lastActivityAt,
    ...overrides,
  };
}

test('only complete in-progress runs are eligible for quick resume', () => {
  const runs = [
    run('active', 'IN_PROGRESS', '2026-11-18T12:00:00.000Z'),
    run('completed', 'COMPLETED', '2026-11-18T13:00:00.000Z'),
    run('abandoned', 'ABANDONED', '2026-11-18T14:00:00.000Z'),
    run('', 'IN_PROGRESS', '2026-11-18T15:00:00.000Z'),
    run('missing-title', 'IN_PROGRESS', '2026-11-18T16:00:00.000Z', { title: ' ' }),
    null,
  ];

  assert.deepEqual(selectActiveRuns(runs).map((item) => item.id), ['active']);
});

test('quick resume orders recent activity first and applies the requested limit', () => {
  const runs = [
    run('older', 'IN_PROGRESS', '2026-11-17T12:00:00.000Z'),
    run('newest', 'IN_PROGRESS', '2026-11-18T12:00:00.000Z'),
    run('middle', 'IN_PROGRESS', '2026-11-18T08:00:00.000Z'),
  ];

  assert.deepEqual(
    selectActiveRuns(runs, 2).map((item) => item.id),
    ['newest', 'middle'],
  );
});

test('invalid activity dates remain eligible but sort behind dated runs', () => {
  const runs = [
    run('unknown-date', 'IN_PROGRESS', 'not-a-date'),
    run('known-date', 'IN_PROGRESS', '2026-11-18T12:00:00.000Z'),
  ];

  assert.deepEqual(
    selectActiveRuns(runs).map((item) => item.id),
    ['known-date', 'unknown-date'],
  );
});

test('non-array data returns an empty result and invalid limits use the default', () => {
  assert.deepEqual(selectActiveRuns(null), []);
  const runs = [
    run('a', 'IN_PROGRESS', '2026-11-18T15:00:00.000Z'),
    run('b', 'IN_PROGRESS', '2026-11-18T14:00:00.000Z'),
    run('c', 'IN_PROGRESS', '2026-11-18T13:00:00.000Z'),
  ];
  assert.deepEqual(selectActiveRuns(runs, 0).map((item) => item.id), ['a', 'b']);
  assert.equal(selectActiveRuns(runs, 50).length, 3);
});
