import { Injectable } from '@nestjs/common';
import type {
  LearningEvidenceKind,
  PlayerLearningEvidence,
  PlayerSkillProgress,
  PlayerSkillStatus,
  PlayerSkillsResponse,
} from '@questoria/contracts';
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
}
