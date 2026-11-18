const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14] as const;

export interface SkillReviewSchedule {
  intervalDays: number;
  dueAt: Date;
  state: 'due' | 'upcoming';
  daysOverdue: number;
}

/**
 * Schedule a lightweight delayed validation after 1 day, then 3, 7 and 14
 * days as successful delayed checks accumulate. Wrong answers do not move
 * the anchor; only the latest successful evidence does.
 */
export function calculateSkillReviewSchedule(
  lastCorrectAt: Date,
  successfulDelayedChecks: number,
  now: Date,
): SkillReviewSchedule {
  const completedChecks = Math.max(0, Math.floor(successfulDelayedChecks));
  const intervalDays = REVIEW_INTERVALS_DAYS[
    Math.min(completedChecks, REVIEW_INTERVALS_DAYS.length - 1)
  ]!;
  const dueAt = new Date(lastCorrectAt.getTime() + intervalDays * DAY_MS);
  const overdueMs = Math.max(0, now.getTime() - dueAt.getTime());

  return {
    intervalDays,
    dueAt,
    state: dueAt.getTime() <= now.getTime() ? 'due' : 'upcoming',
    daysOverdue: Math.floor(overdueMs / DAY_MS),
  };
}
