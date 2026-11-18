export interface HealthResponse {
  status: 'ok';
  service: 'questoria-api';
  timestamp: string;
}

export interface HealthReadinessResponse {
  status: 'ready';
  service: 'questoria-api';
  timestamp: string;
  checks: {
    database: 'ok';
  };
}

export interface PlayerAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  awardedAt: string | null;
  xpReward: number;
  coinsReward: number;
  xpAwarded: number;
  coinsAwarded: number;
}

export interface PlayerAchievementsResponse {
  achievements: PlayerAchievement[];
  history: PlayerAchievement[];
  unlockedCount: number;
  totalCount: number;
}
