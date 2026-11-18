function activityTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isActiveRun(run) {
  return Boolean(
    run
    && typeof run === 'object'
    && typeof run.id === 'string'
    && run.id.length > 0
    && typeof run.title === 'string'
    && run.title.trim().length > 0
    && run.status === 'IN_PROGRESS'
    && typeof run.completedLevels === 'number'
    && Number.isFinite(run.completedLevels)
    && typeof run.score === 'number'
    && Number.isFinite(run.score)
    && typeof run.lastActivityAt === 'string',
  );
}

export function selectActiveRuns(runs, limit = 2) {
  if (!Array.isArray(runs)) return [];

  const safeLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, 5)
    : 2;

  return runs
    .filter(isActiveRun)
    .sort((left, right) => (
      activityTimestamp(right.lastActivityAt) - activityTimestamp(left.lastActivityAt)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, safeLimit);
}
