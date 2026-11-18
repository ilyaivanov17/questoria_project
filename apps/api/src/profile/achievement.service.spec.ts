import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AchievementService } from './achievement.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const awardedAt = new Date('2026-11-18T10:00:00.000Z');

function createService() {
  const transactionOptions: Array<{ isolationLevel?: string }> = [];
  const tx = {
    achievement: {
      findMany: async () => [
        {
          id: 'achievement-1',
          code: 'first-quest',
          title: 'Первое открытие',
          description: 'Заверши свой первый квест',
          icon: '✦',
          xpReward: 0,
          coinsReward: 0,
        },
        {
          id: 'achievement-2',
          code: 'three-quests',
          title: 'Следопыт',
          description: 'Заверши три разных квеста',
          icon: '⌖',
          xpReward: 25,
          coinsReward: 0,
        },
      ],
    },
    profileAchievement: {
      findMany: async () => [{
        achievementId: 'achievement-1',
        awardedAt,
        xpAwarded: 10,
        coinsAwarded: 0,
      }],
    },
  };
  const prisma = {
    $transaction: async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel?: string },
    ) => {
      transactionOptions.push(options);
      return callback(tx);
    },
  } as unknown as PrismaService;

  return { service: new AchievementService(prisma), transactionOptions };
}

test('returns persisted unlock state, reward receipt and locked catalog entries', async () => {
  const { service, transactionOptions } = createService();

  const result = await service.getAchievements(profileId);

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(result.totalCount, 2);
  assert.equal(result.unlockedCount, 1);
  assert.deepEqual(result.achievements[0], {
    id: 'first-quest',
    title: 'Первое открытие',
    description: 'Заверши свой первый квест',
    icon: '✦',
    unlocked: true,
    awardedAt: awardedAt.toISOString(),
    xpReward: 0,
    coinsReward: 0,
    xpAwarded: 0,
    coinsAwarded: 0,
  });
  assert.deepEqual(result.achievements[1], {
    id: 'three-quests',
    title: 'Следопыт',
    description: 'Заверши три разных квеста',
    icon: '⌖',
    unlocked: false,
    awardedAt: null,
    xpReward: 25,
    coinsReward: 0,
    xpAwarded: 0,
    coinsAwarded: 0,
  });
  assert.deepEqual(result.history, [result.achievements[0]]);
});
