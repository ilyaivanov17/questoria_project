import { Injectable } from '@nestjs/common';
import type {
  PlayerAchievement,
  PlayerAchievementsResponse,
} from '@questoria/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AchievementService {
  constructor(private readonly prisma: PrismaService) {}

  async getAchievements(profileId: string): Promise<PlayerAchievementsResponse> {
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const [definitions, awards] = await Promise.all([
        tx.achievement.findMany({
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            icon: true,
            xpReward: true,
            coinsReward: true,
          },
        }),
        tx.profileAchievement.findMany({
          where: { profileId },
          select: {
            achievementId: true,
            awardedAt: true,
            xpAwarded: true,
            coinsAwarded: true,
          },
        }),
      ]);

      return { definitions, awards };
    }, { isolationLevel: 'RepeatableRead' });

    const awardsById = new Map(
      snapshot.awards.map((award) => [award.achievementId, award]),
    );

    const achievements: PlayerAchievement[] = snapshot.definitions.map((definition) => {
      const award = awardsById.get(definition.id) ?? null;
      return {
        id: definition.code,
        title: definition.title,
        description: definition.description,
        icon: definition.icon,
        unlocked: award !== null,
        awardedAt: award?.awardedAt.toISOString() ?? null,
        xpReward: definition.xpReward,
        coinsReward: definition.coinsReward,
        xpAwarded: award?.xpAwarded ?? 0,
        coinsAwarded: award?.coinsAwarded ?? 0,
      };
    });

    const history = achievements
      .filter((achievement) => achievement.unlocked)
      .sort((left, right) => (
        (left.awardedAt ?? '').localeCompare(right.awardedAt ?? '')
      ));

    return {
      achievements,
      history,
      unlockedCount: history.length,
      totalCount: achievements.length,
    };
  }
}
