import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesDuration, missionCountLabel } from './catalog-utils.mjs';

test('missionCountLabel uses correct Russian plural forms', () => {
  const cases = [
    [0, 'миссий'],
    [1, 'миссия'],
    [2, 'миссии'],
    [4, 'миссии'],
    [5, 'миссий'],
    [11, 'миссий'],
    [14, 'миссий'],
    [21, 'миссия'],
    [22, 'миссии'],
    [25, 'миссий'],
    [101, 'миссия'],
    [112, 'миссий'],
  ];

  for (const [count, expected] of cases) {
    assert.equal(missionCountLabel(count), expected, 'count: ' + count);
  }
});

test('duration filter includes the exact boundaries', () => {
  assert.equal(matchesDuration(10, 'quick'), true);
  assert.equal(matchesDuration(10.1, 'quick'), false);
  assert.equal(matchesDuration(10, 'standard'), false);
  assert.equal(matchesDuration(11, 'standard'), true);
  assert.equal(matchesDuration(20, 'standard'), true);
  assert.equal(matchesDuration(20.1, 'standard'), false);
  assert.equal(matchesDuration(21, 'long'), true);
});

test('all duration filter keeps valid and unknown durations unchanged', () => {
  assert.equal(matchesDuration(5, 'all'), true);
  assert.equal(matchesDuration(30, 'all'), true);
  assert.equal(matchesDuration(-1, 'quick'), false);
  assert.equal(matchesDuration(Number.NaN, 'long'), false);
  assert.equal(matchesDuration(12, 'unknown'), false);
});
