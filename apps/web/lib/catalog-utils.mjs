export function missionCountLabel(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'миссий';
  if (last === 1) return 'миссия';
  if (last >= 2 && last <= 4) return 'миссии';
  return 'миссий';
}

export function matchesDuration(durationMin, duration) {
  if (duration === 'all') return true;
  if (!Number.isFinite(durationMin) || durationMin < 0) return false;
  if (duration === 'quick') return durationMin <= 10;
  if (duration === 'standard') return durationMin > 10 && durationMin <= 20;
  if (duration === 'long') return durationMin > 20;
  return false;
}
