import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSkillReviewSchedule } from './review-schedule.js';

const dayMs = 24 * 60 * 60 * 1000;
const anchor = new Date('2026-11-01T10:00:00.000Z');

test('review intervals increase after successful delayed checks', () => {
  const now = new Date(anchor.getTime());

  assert.equal(calculateSkillReviewSchedule(anchor, 0, now).intervalDays, 1);
  assert.equal(calculateSkillReviewSchedule(anchor, 1, now).intervalDays, 3);
  assert.equal(calculateSkillReviewSchedule(anchor, 2, now).intervalDays, 7);
  assert.equal(calculateSkillReviewSchedule(anchor, 3, now).intervalDays, 14);
  assert.equal(calculateSkillReviewSchedule(anchor, 20, now).intervalDays, 14);
});

test('marks a review due at the interval boundary and counts full overdue days', () => {
  const dueAt = new Date(anchor.getTime() + dayMs);
  const beforeDue = calculateSkillReviewSchedule(anchor, 0, new Date(dueAt.getTime() - 1));
  const exactlyDue = calculateSkillReviewSchedule(anchor, 0, dueAt);
  const twoDaysOverdue = calculateSkillReviewSchedule(
    anchor,
    0,
    new Date(dueAt.getTime() + 2 * dayMs),
  );

  assert.equal(beforeDue.state, 'upcoming');
  assert.equal(beforeDue.daysOverdue, 0);
  assert.equal(exactlyDue.state, 'due');
  assert.equal(exactlyDue.daysOverdue, 0);
  assert.equal(twoDaysOverdue.state, 'due');
  assert.equal(twoDaysOverdue.daysOverdue, 2);
});

test('does not let a wrong answer change the successful-evidence review anchor', () => {
  const schedule = calculateSkillReviewSchedule(anchor, 1, new Date(anchor.getTime() + 2 * dayMs));

  assert.equal(schedule.intervalDays, 3);
  assert.equal(schedule.dueAt.toISOString(), new Date(anchor.getTime() + 3 * dayMs).toISOString());
  assert.equal(schedule.state, 'upcoming');
});
