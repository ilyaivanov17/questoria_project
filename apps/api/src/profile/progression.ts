export interface PlayerStats {
  completedQuests: number;
  completedRuns: number;
  completedLevels: number;
}

export function getPlayerProgression(xp: number, stats: PlayerStats) {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  let xpAtLevelStart = 0;
  let xpForNextLevel = 100;

  while (safeXp >= xpAtLevelStart + xpForNextLevel) {
    xpAtLevelStart += xpForNextLevel;
    level += 1;
    xpForNextLevel = level * 100;
  }

  const xpIntoLevel = safeXp - xpAtLevelStart;
  const achievements = [
    { id: 'first-quest', title: 'Первое открытие', description: 'Заверши свой первый квест', icon: '✦', unlocked: stats.completedQuests >= 1 },
    { id: 'three-quests', title: 'Следопыт', description: 'Заверши три разных квеста', icon: '⌖', unlocked: stats.completedQuests >= 3 },
    { id: 'five-levels', title: 'Покоритель этапов', description: 'Пройди пять игровых этапов', icon: '◇', unlocked: stats.completedLevels >= 5 },
    { id: 'hundred-xp', title: 'Сотня опыта', description: 'Накопи 100 XP', icon: '⚡', unlocked: safeXp >= 100 },
    { id: 'ten-runs', title: 'Упорство', description: 'Заверши десять прохождений', icon: '★', unlocked: stats.completedRuns >= 10 },
  ];

  return {
    level,
    totalXp: safeXp,
    xpIntoLevel,
    xpForNextLevel,
    xpToNextLevel: xpForNextLevel - xpIntoLevel,
    progressPercent: Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)),
    achievements,
    unlockedAchievements: achievements.filter((item) => item.unlocked).length,
  };
}
