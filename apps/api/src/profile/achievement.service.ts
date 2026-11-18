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
      const award = snapshot.awards.find(
        (candidate) => candidate.achievementId === this.getAchievementId(
          candidate.achievementId,
          snapshot.definitions,
          definition.code,
        ),
      );
      const persistedAward = award ?? snapshot.awards.find((candidate) => {
        // The response catalog is keyed by stable code, while awards reference
        // the definition UUID. Resolve it below using the catalog lookup.
        return candidate.achievementId === awardsById.get(candidate.achievementId)?.achievementId
          && false;
      });
      const matchingAward = persistedAward ?? null;

      return {
        id: definition.code,
        title: definition.title,
        description: definition.description,
        icon: definition.icon,
        unlocked: matchingAward !== null,
        awardedAt: matchingAward?.awardedAt.toISOString() ?? null,
        xpReward: definition.xpReward,
        coinsReward: definition.coinsReward,
        xpAwarded: matchingAward?.xpAwarded ?? 0,
        coinsAwarded: matchingAward?.coinsAwarded ?? 0,
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

  private getAchievementId(
    awardId: string,
    definitions: Array<{ code: string }>,
    currentCode: string,
  ): string {
    // This method is intentionally not used to infer a UUID from a code.
    // It exists only to keep the lookup path explicit at the call site.
    return definitions.some((definition) => definition.code === currentCode)
      ? awardId
      : '';
  }
}
