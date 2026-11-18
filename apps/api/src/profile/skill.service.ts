import { Injectable } from '@nestjs/common';
import type {
  LearningEvidenceKind,
  PlayerLearningEvidence,
  PlayerSkillProgress,
  PlayerSkillStatus,
  PlayerSkillsResponse,
  PlayerSkillReviewQueueResponse,
} from '@questoria/contracts';
import { calculateSkillReviewSchedule } from './review-schedule.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SkillService {
  constructor(private readonly prisma: PrismaService) {}

  async getSkills(profileId: string): Promise<PlayerSkillsResponse> {
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const [definitions, recentEvidence] = await Promise.all([
        tx.skill.findMany({
          orderBy: { name: 'asc' },
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            difficulty: true,
            progress: {
              where: { profileId },
              select: {
                status: true,
                attemptsCount: true,
                successfulAttempts: true,
                distinctPuzzles: true,
                distinctQuestVersions: true,
                distinctQuests: true,
                distinctRuns: true,
                distinctTaskTypes: true,
                firstPracticedAt: true,
                lastPracticedAt: true,
                masteredAt: true,
              },
              take: 1,
            },
            prerequisites: {
              include: {
                prerequisite: {
                  select: {
                    id: true,
                    key: true,
                    name: true,
                    progress: {
                      where: { profileId },
                      select: { status: true },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        }),
        tx.learningEvidence.findMany({
          where: { profileId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 50,
          select: {
            id: true,
            taskType: true,
            evidenceType: true,
            isCorrect: true,
            score: true,
            occurredAt: true,
            skill: { select: { key: true, name: true } },
            questVersion: {
              select: {
                title: true,
                quest: { select: { slug: true } },
              },
            },
            puzzle: {
              select: {
                orderNo: true,
                level: { select: { title: true } },
              },
            },
          },
        }),
      ]);

      return { definitions, recentEvidence };
    }, { isolationLevel: 'RepeatableRead' });

    const skills: PlayerSkillProgress[] = snapshot.definitions.map((definition) => {
      const progress = definition.progress[0];
      return {
        id: definition.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        difficulty: definition.difficulty,
        status: (progress?.status.toLowerCase() ?? 'not_started') as PlayerSkillStatus,
        available: definition.prerequisites.every((edge) => (
          edge.prerequisite.progress[0]?.status === 'MASTERED'
        )),
        prerequisites: definition.prerequisites.map((edge) => {
          const prerequisiteProgress = edge.prerequisite.progress[0];
          const status = (prerequisiteProgress?.status.toLowerCase() ?? 'not_started') as PlayerSkillStatus;
          return {
            id: edge.prerequisite.id,
            key: edge.prerequisite.key,
            name: edge.prerequisite.name,
            status,
            mastered: status === 'mastered',
          };
        }),
        attemptsCount: progress?.attemptsCount ?? 0,
        successfulAttempts: progress?.successfulAttempts ?? 0,
        distinctPuzzles: progress?.distinctPuzzles ?? 0,
        distinctQuestVersions: progress?.distinctQuestVersions ?? 0,
        distinctQuests: progress?.distinctQuests ?? 0,
        distinctRuns: progress?.distinctRuns ?? 0,
        distinctTaskTypes: progress?.distinctTaskTypes ?? 0,
        firstPracticedAt: progress?.firstPracticedAt?.toISOString() ?? null,
        lastPracticedAt: progress?.lastPracticedAt?.toISOString() ?? null,
        masteredAt: progress?.masteredAt?.toISOString() ?? null,
      };
    });

    const recentEvidence: PlayerLearningEvidence[] = snapshot.recentEvidence.map((item) => ({
      id: item.id,
      skillKey: item.skill.key,
      skillName: item.skill.name,
      taskType: item.taskType,
      evidenceType: item.evidenceType.toLowerCase() as LearningEvidenceKind,
      isCorrect: item.isCorrect,
      score: item.score,
      occurredAt: item.occurredAt.toISOString(),
      questTitle: item.questVersion.title,
      questSlug: item.questVersion.quest.slug,
      levelTitle: item.puzzle.level.title,
      puzzleOrder: item.puzzle.orderNo,
    }));

    return {
      skills,
      recentEvidence,
      summary: {
        totalSkills: skills.length,
        practicedSkills: skills.filter((skill) => skill.attemptsCount > 0).length,
        masteredSkills: skills.filter((skill) => skill.status === 'mastered').length,
      },
    };
  }

  async getReviewQueue(profileId: string, now: Date = new Date()): Promise<PlayerSkillReviewQueueResponse> {
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const [definitions, latestSuccessfulEvidence, delayedChecks, publishedVersions] = await Promise.all([
        tx.skill.findMany({
          orderBy: { name: 'asc' },
          select: {
            id: true,
            key: true,
            name: true,
            progress: {
              where: { profileId },
              select: { status: true },
              take: 1,
            },
            prerequisites: {
              select: { prerequisiteId: true },
            },
          },
        }),
        tx.learningEvidence.groupBy({
          by: ['skillId'],
          where: { profileId, isCorrect: true },
          _max: { occurredAt: true },
        }),
        tx.learningEvidence.groupBy({
          by: ['skillId'],
          where: { profileId, isCorrect: true, evidenceType: 'DELAYED_CHECK' },
          _count: { _all: true },
        }),
        tx.questVersion.findMany({
          where: {
            status: 'PUBLISHED',
            quest: { status: 'PUBLISHED' },
          },
          orderBy: [{ title: 'asc' }, { versionNo: 'desc' }],
          select: {
            title: true,
            difficulty: true,
            durationMin: true,
            skills: true,
            quest: { select: { slug: true } },
          },
        }),
      ]);

      return { definitions, latestSuccessfulEvidence, delayedChecks, publishedVersions };
    }, { isolationLevel: 'RepeatableRead' });

    const definitionsById = new Map(snapshot.definitions.map((definition) => [definition.id, definition]));
    const aliases = new Map<string, string[]>();
    const normalize = (value: string) => value.trim().normalize('NFKC').toLowerCase();

    for (const definition of snapshot.definitions) {
      for (const alias of [definition.key, definition.name]) {
        const key = normalize(alias);
        const matches = aliases.get(key) ?? [];
        if (!matches.includes(definition.id)) matches.push(definition.id);
        aliases.set(key, matches);
      }
    }

    const latestSuccessBySkill = new Map(
      snapshot.latestSuccessfulEvidence.map((row) => [row.skillId, row._max.occurredAt]),
    );
    const delayedCheckCountBySkill = new Map(
      snapshot.delayedChecks.map((row) => [row.skillId, row._count._all]),
    );

    const prerequisitesAreMastered = (skillId: string, visiting = new Set<string>()): boolean => {
      if (visiting.has(skillId)) return false;
      const definition = definitionsById.get(skillId);
      if (!definition) return false;

      visiting.add(skillId);
      const mastered = definition.prerequisites.every((edge) => {
        const prerequisite = definitionsById.get(edge.prerequisiteId);
        return Boolean(
          prerequisite
          && prerequisite.progress[0]?.status === 'MASTERED'
          && prerequisitesAreMastered(prerequisite.id, visiting),
        );
      });
      visiting.delete(skillId);
      return mastered;
    };

    const resolveQuestSkills = (tags: string[]): string[] | null => {
      const ids: string[] = [];
      for (const tag of tags) {
        const matches = aliases.get(normalize(tag)) ?? [];
        if (matches.length !== 1) return null;
        if (!ids.includes(matches[0]!)) ids.push(matches[0]!);
      }
      return ids.length > 0 ? ids : null;
    };

    const nowMs = now.getTime();
    const horizonMs = nowMs + 14 * 24 * 60 * 60 * 1000;
    const items: PlayerSkillReviewQueueResponse['items'] = [];

    for (const definition of snapshot.definitions) {
      const lastCorrectAt = latestSuccessBySkill.get(definition.id);
      if (!lastCorrectAt) continue;

      const schedule = calculateSkillReviewSchedule(
        lastCorrectAt,
        delayedCheckCountBySkill.get(definition.id) ?? 0,
        now,
      );
      if (schedule.dueAt.getTime() > horizonMs) continue;

      const recommendedQuests = snapshot.publishedVersions
        .filter((version) => {
          const targetSkills = resolveQuestSkills(version.skills);
          return Boolean(
            targetSkills
            && targetSkills.includes(definition.id)
            && targetSkills.every((skillId) => prerequisitesAreMastered(skillId)),
          );
        })
        .reduce<PlayerSkillReviewQueueResponse['items'][number]['recommendedQuests']>((result, version) => {
          if (result.some((quest) => quest.slug === version.quest.slug)) return result;
          result.push({
            slug: version.quest.slug,
            title: version.title,
            difficulty: version.difficulty,
            durationMin: version.durationMin,
          });
          return result;
        }, [])
        .slice(0, 3);

      items.push({
        skillId: definition.id,
        skillKey: definition.key,
        skillName: definition.name,
        skillStatus: (definition.progress[0]?.status.toLowerCase() ?? 'not_started') as PlayerSkillReviewQueueResponse['items'][number]['skillStatus'],
        lastCorrectAt: lastCorrectAt.toISOString(),
        dueAt: schedule.dueAt.toISOString(),
        intervalDays: schedule.intervalDays,
        daysOverdue: schedule.daysOverdue,
        state: schedule.state,
        recommendedQuests,
      });
    }

    items.sort((left, right) => {
      if (left.state !== right.state) return left.state === 'due' ? -1 : 1;
      return left.dueAt.localeCompare(right.dueAt)
        || left.skillName.localeCompare(right.skillName, 'ru');
    });

    const dueCount = items.filter((item) => item.state === 'due').length;
    return {
      generatedAt: now.toISOString(),
      items,
      summary: {
        dueCount,
        upcomingCount: items.length - dueCount,
        totalCount: items.length,
      },
    };
  }

}
