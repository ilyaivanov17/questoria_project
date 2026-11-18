import type { PlayerSkillLearningTrend } from '@questoria/contracts';

const TREND_WINDOW_SIZE = 5;
const TREND_CHANGE_THRESHOLD = 20;

/**
 * Compares the five most recent outcomes with the five immediately before them.
 * Input must be ordered newest first. Small samples are reported as insufficient,
 * rather than being presented as a meaningful trend.
 */
export function calculateSkillLearningTrend(
  evidence: ReadonlyArray<{ isCorrect: boolean }>,
): PlayerSkillLearningTrend {
  const recent = evidence.slice(0, TREND_WINDOW_SIZE);
  const previous = evidence.slice(TREND_WINDOW_SIZE, TREND_WINDOW_SIZE * 2);
  const successful = (events: ReadonlyArray<{ isCorrect: boolean }>) =>
    events.filter((event) => event.isCorrect).length;
  const successRate = (events: ReadonlyArray<{ isCorrect: boolean }>, count: number) =>
    events.length ? Math.round((count / events.length) * 100) : null;

  const recentSuccessful = successful(recent);
  const previousSuccessful = successful(previous);
  const recentSuccessRate = successRate(recent, recentSuccessful);
  const previousSuccessRate = successRate(previous, previousSuccessful);

  let direction: PlayerSkillLearningTrend['direction'] = 'insufficient_data';
  if (recent.length === TREND_WINDOW_SIZE && previous.length === TREND_WINDOW_SIZE) {
    const difference = (recentSuccessRate ?? 0) - (previousSuccessRate ?? 0);
    if (difference >= TREND_CHANGE_THRESHOLD) direction = 'improving';
    else if (difference <= -TREND_CHANGE_THRESHOLD) direction = 'declining';
    else direction = 'stable';
  }

  return {
    direction,
    recentAttempts: recent.length,
    recentSuccessful,
    recentSuccessRate,
    previousAttempts: previous.length,
    previousSuccessful,
    previousSuccessRate,
  };
}
