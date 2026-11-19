import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import type { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto.js';
import type { CreateQuestDto, LevelInputDto, PuzzleInputDto, UpdateQuestDto } from './dto/quest.dto.js';
import { validatePuzzleAnswer } from '../quests/puzzle-validator.js';
import { isSelfManagement, wouldRemoveLastActiveSuperAdmin } from './user-management.policy.js';
import { AUDIT_LOG_EXPORT_LIMIT, buildAuditLogWhere, type AuditLogFilters } from './audit-log.query.js';
import { canManageQuestDraft, canViewAllQuestVersions } from './cms-authorization.js';

const EDITABLE_STATUSES = ['DRAFT'] as const;

type Transaction = Prisma.TransactionClient;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeSkillKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeSkillText(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function puzzleAnswerForDefinition(type: string, solution: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'single_choice': return { optionId: solution.correctOptionId };
    case 'multiple_choice': return { optionIds: solution.correctOptionIds };
    case 'numeric_input': return { value: solution.correctValue };
    case 'text_input': return {
      text: Array.isArray(solution.acceptedAnswers) ? solution.acceptedAnswers[0] : undefined,
    };
    case 'ordering': return { orderedIds: solution.correctOrderIds };
    default: return {};
  }
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminIdentity(user: AuthenticatedUser): Promise<object> {
    return {
      userId: user.userId,
      email: user.email,
      roleKeys: user.roleKeys,
      mfaEnabled: user.mfaEnabled,
      sessionMfaVerified: user.sessionMfaVerified,
    };
  }

  async listCategories(): Promise<object[]> {
    return this.prisma.category.findMany({
      orderBy: [{ locale: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true, slug: true, locale: true, title: true, description: true,
        status: true, sortOrder: true, updatedAt: true,
      },
    });
  }

  async createCategory(user: AuthenticatedUser, dto: CreateCategoryDto): Promise<object> {
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          slug: dto.slug,
          locale: dto.locale,
          title: dto.title.trim(),
          description: dto.description.trim(),
          sortOrder: dto.sortOrder ?? 0,
          status: 'DRAFT',
        },
      });
      await this.audit(tx, user.userId, 'category.created', 'CATEGORY', created.id, undefined, created);
      return created;
    });
    return category;
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: UpdateCategoryDto): Promise<object> {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Category not found.');
    if (current.status === 'ARCHIVED') throw new ConflictException('Archived categories cannot be edited.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.audit(tx, user.userId, 'category.updated', 'CATEGORY', id, current, updated);
      return updated;
    });
  }

  async archiveCategory(user: AuthenticatedUser, id: string): Promise<object> {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Category not found.');
    if (current.status === 'ARCHIVED') return { id, status: 'ARCHIVED' };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.audit(tx, user.userId, 'category.archived', 'CATEGORY', id, current, updated);
      return { id: updated.id, status: updated.status };
    });
  }

  async publishCategory(user: AuthenticatedUser, id: string): Promise<object> {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Category not found.');
    if (current.status === 'ARCHIVED') throw new ConflictException('Archived categories cannot be published.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await this.audit(tx, user.userId, 'category.published', 'CATEGORY', id, current, updated);
      return { id: updated.id, status: updated.status };
    });
  }

  async listQuestReviewers(): Promise<object[]> {
    const reviewers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'] } } } },
      },
      orderBy: { emailNormalized: 'asc' },
      select: {
        id: true,
        emailNormalized: true,
        profile: { select: { nickname: true } },
      },
    });
    return reviewers.map((reviewer) => ({
      id: reviewer.id,
      email: reviewer.emailNormalized,
      nickname: reviewer.profile?.nickname ?? null,
    }));
  }

  async listQuests(user: AuthenticatedUser): Promise<object[]> {
    const authorOnly = !canViewAllQuestVersions(user);
    const quests = await this.prisma.quest.findMany({
      where: authorOnly
        ? {
          OR: [
            { status: 'PUBLISHED' },
            { versions: { some: { authorId: user.userId } } },
          ],
        }
        : {},
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { title: true, slug: true } },
        versions: {
          where: authorOnly
            ? { OR: [{ authorId: user.userId }, { status: 'PUBLISHED' }] }
            : {},
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: {
            id: true, versionNo: true, title: true, status: true, updatedAt: true, authorId: true,
            reviewerId: true,
            author: { select: { emailNormalized: true, profile: { select: { nickname: true } } } },
            reviewer: { select: { emailNormalized: true, profile: { select: { nickname: true } } } },
          },
        },
      },
    });
    return quests.map((quest) => ({
      id: quest.id,
      slug: quest.slug,
      status: quest.status,
      category: quest.category,
      canEditDraft: Boolean(
        quest.versions[0]?.status === 'DRAFT'
        && canManageQuestDraft(user, quest.versions[0].authorId),
      ),
      latestVersion: quest.versions[0]
        ? {
          id: quest.versions[0].id,
          versionNo: quest.versions[0].versionNo,
          title: quest.versions[0].title,
          status: quest.versions[0].status,
          updatedAt: quest.versions[0].updatedAt,
          ...(authorOnly ? {} : {
            reviewerId: quest.versions[0].reviewerId,
            author: quest.versions[0].author
              ? {
                email: quest.versions[0].author.emailNormalized,
                nickname: quest.versions[0].author.profile?.nickname ?? null,
              }
              : null,
            reviewer: quest.versions[0].reviewer
              ? {
                email: quest.versions[0].reviewer.emailNormalized,
                nickname: quest.versions[0].reviewer.profile?.nickname ?? null,
              }
              : null,
          }),
        }
        : null,
    }));
  }

  async getQuestVersions(user: AuthenticatedUser, id: string): Promise<object> {
    const authorOnly = !canViewAllQuestVersions(user);
    const quest = await this.prisma.quest.findFirst({
      where: {
        id,
        ...(authorOnly
          ? {
            OR: [
              { status: 'PUBLISHED' },
              { versions: { some: { authorId: user.userId } } },
            ],
          }
          : {}),
      },
      include: {
        category: true,
        versions: {
          where: authorOnly
            ? { OR: [{ authorId: user.userId }, { status: 'PUBLISHED' }] }
            : {},
          orderBy: { versionNo: 'desc' },
          include: {
            levels: {
              orderBy: { orderNo: 'asc' },
              include: {
                puzzles: {
                  orderBy: { orderNo: 'asc' },
                  include: { hints: { orderBy: { orderNo: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
    if (!quest) throw new NotFoundException('Quest not found.');

    return {
      ...quest,
      versions: quest.versions.map((version) => {
        if (!authorOnly || version.authorId === user.userId) return version;
        return {
          ...version,
          levels: version.levels.map((level) => ({
            ...level,
            puzzles: level.puzzles.map((puzzle) => {
              const safePuzzle = { ...puzzle };
              Reflect.deleteProperty(safePuzzle, 'solutionPrivate');
              return safePuzzle;
            }),
          })),
        };
      }),
    };
  }

  async getQuest(user: AuthenticatedUser, id: string): Promise<object> {
    const authorOnly = !canViewAllQuestVersions(user);
    const quest = await this.prisma.quest.findFirst({
      where: {
        id,
        ...(authorOnly
          ? {
            OR: [
              { status: 'PUBLISHED' },
              { versions: { some: { authorId: user.userId } } },
            ],
          }
          : {}),
      },
      include: {
        category: true,
        versions: {
          where: authorOnly
            ? { OR: [{ authorId: user.userId }, { status: 'PUBLISHED' }] }
            : {},
          orderBy: { versionNo: 'desc' },
          take: 1,
          include: {
            levels: {
              orderBy: { orderNo: 'asc' },
              include: {
                puzzles: {
                  orderBy: { orderNo: 'asc' },
                  include: { hints: { orderBy: { orderNo: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
    if (!quest) throw new NotFoundException('Quest not found.');
    const latestVersion = quest.versions[0];
    if (authorOnly && latestVersion && latestVersion.authorId !== user.userId) {
      return {
        ...quest,
        versions: quest.versions.map((version) => ({
          ...version,
          levels: version.levels.map((level) => ({
            ...level,
            puzzles: level.puzzles.map((puzzle) => {
              const safePuzzle = { ...puzzle };
              Reflect.deleteProperty(safePuzzle, 'solutionPrivate');
              return safePuzzle;
            }),
          })),
        })),
      };
    }
    return quest;
  }

  async listSkills(): Promise<object[]> {
    const skills = await this.prisma.skill.findMany({
      orderBy: [{ name: 'asc' }, { key: 'asc' }],
      include: {
        prerequisites: {
          include: {
            prerequisite: {
              select: { id: true, key: true, name: true, description: true, difficulty: true },
            },
          },
        },
        unlocks: {
          include: {
            skill: { select: { id: true, key: true, name: true } },
          },
        },
        _count: { select: { evidence: true, progress: true } },
      },
    });

    return skills.map((skill) => ({
      id: skill.id,
      key: skill.key,
      name: skill.name,
      description: skill.description,
      difficulty: skill.difficulty,
      prerequisites: skill.prerequisites.map((edge) => edge.prerequisite),
      unlocks: skill.unlocks.map((edge) => edge.skill),
      evidenceCount: skill._count.evidence,
      learnerCount: skill._count.progress,
      createdAt: skill.createdAt,
    }));
  }

  async getLearningAnalytics(): Promise<object> {
    const [skills, evidenceGroups, progressGroups] = await Promise.all([
      this.prisma.skill.findMany({
        orderBy: [{ name: 'asc' }, { key: 'asc' }],
        select: { id: true, key: true, name: true },
      }),
      this.prisma.learningEvidence.groupBy({
        by: ['skillId', 'taskType', 'isCorrect'],
        _count: { _all: true },
      }),
      this.prisma.profileSkillProgress.groupBy({
        by: ['skillId', 'status'],
        _count: { _all: true },
      }),
    ]);

    const evidenceBySkill = new Map<string, {
      total: number;
      successful: number;
      tasks: Map<string, { total: number; successful: number }>;
    }>();
    for (const group of evidenceGroups) {
      const current = evidenceBySkill.get(group.skillId) ?? {
        total: 0, successful: 0, tasks: new Map(),
      };
      const count = group._count._all;
      current.total += count;
      if (group.isCorrect) current.successful += count;
      const task = current.tasks.get(group.taskType) ?? { total: 0, successful: 0 };
      task.total += count;
      if (group.isCorrect) task.successful += count;
      current.tasks.set(group.taskType, task);
      evidenceBySkill.set(group.skillId, current);
    }

    const progressBySkill = new Map<string, {
      learners: number;
      mastered: number;
      practicing: number;
      developing: number;
      proficient: number;
    }>();
    for (const group of progressGroups) {
      const current = progressBySkill.get(group.skillId) ?? {
        learners: 0, mastered: 0, practicing: 0, developing: 0, proficient: 0,
      };
      current.learners += group._count._all;
      switch (group.status) {
        case 'MASTERED': current.mastered += group._count._all; break;
        case 'PRACTICING': current.practicing += group._count._all; break;
        case 'DEVELOPING': current.developing += group._count._all; break;
        case 'PROFICIENT': current.proficient += group._count._all; break;
      }
      progressBySkill.set(group.skillId, current);
    }

    const skillMetrics = skills.map((skill) => {
      const evidence = evidenceBySkill.get(skill.id) ?? { total: 0, successful: 0, tasks: new Map() };
      const progress = progressBySkill.get(skill.id) ?? {
        learners: 0, mastered: 0, practicing: 0, developing: 0, proficient: 0,
      };
      const successRate = evidence.total ? Math.round((evidence.successful / evidence.total) * 100) : null;
      const taskTypes = [...evidence.tasks.entries()]
        .map(([taskType, counts]) => ({
          taskType,
          attempts: counts.total,
          successful: counts.successful,
          successRate: Math.round((counts.successful / counts.total) * 100),
        }))
        .sort((left, right) => left.taskType.localeCompare(right.taskType));
      const masteryRate = progress.learners
        ? Math.round((progress.mastered / progress.learners) * 100)
        : null;
      const qualitySignals: string[] = [];
      if (evidence.total > 0 && evidence.total < 10) qualitySignals.push('LOW_SAMPLE_SIZE');
      if (evidence.total >= 10 && successRate !== null && successRate < 40) {
        qualitySignals.push('LOW_SUCCESS_RATE');
      }
      if (taskTypes.length < 2 && evidence.total > 0) qualitySignals.push('LOW_TASK_DIVERSITY');
      return {
        skillId: skill.id,
        skillKey: skill.key,
        skillName: skill.name,
        evidence: {
          attempts: evidence.total,
          successful: evidence.successful,
          successRate,
          taskTypeCount: taskTypes.length,
          taskTypes,
        },
        learners: progress.learners,
        mastery: {
          mastered: progress.mastered,
          proficient: progress.proficient,
          developing: progress.developing,
          practicing: progress.practicing,
          masteryRate,
        },
        qualitySignals,
      };
    });

    const totals = skillMetrics.reduce((sum, skill) => ({
      skills: sum.skills + 1,
      evidence: sum.evidence + skill.evidence.attempts,
      successfulEvidence: sum.successfulEvidence + skill.evidence.successful,
      learners: sum.learners + skill.learners,
      masteredLearners: sum.masteredLearners + skill.mastery.mastered,
    }), { skills: 0, evidence: 0, successfulEvidence: 0, learners: 0, masteredLearners: 0 });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        ...totals,
        successRate: totals.evidence
          ? Math.round((totals.successfulEvidence / totals.evidence) * 100)
          : null,
        masteryRate: totals.learners
          ? Math.round((totals.masteredLearners / totals.learners) * 100)
          : null,
      },
      skills: skillMetrics,
    };
  }


  async getTaskLearningAnalytics(): Promise<object> {
    const [groups, puzzleRows, skillRows] = await Promise.all([
      this.prisma.learningEvidence.groupBy({
        by: ['puzzleId', 'skillId', 'profileId', 'taskType', 'evidenceType', 'isCorrect'],
        _count: { _all: true },
      }),
      this.prisma.puzzle.findMany({
        where: { learningEvidence: { some: {} } },
        select: {
          id: true,
          orderNo: true,
          type: true,
          level: {
            select: {
              orderNo: true,
              title: true,
              questVersion: {
                select: {
                  id: true,
                  versionNo: true,
                  title: true,
                  quest: { select: { slug: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.skill.findMany({ select: { id: true, key: true, name: true } }),
    ]);

    const profileIds = [...new Set(groups.map((group) => group.profileId))];
    const skillIds = [...new Set(groups.map((group) => group.skillId))];
    const progressRows = profileIds.length && skillIds.length
      ? await this.prisma.profileSkillProgress.findMany({
          where: { profileId: { in: profileIds }, skillId: { in: skillIds } },
          select: { profileId: true, skillId: true, status: true },
        })
      : [];
    const statusByLearnerSkill = new Map(
      progressRows.map((row) => [`${row.profileId}:${row.skillId}`, row.status]),
    );
    const puzzleById = new Map(puzzleRows.map((puzzle) => [puzzle.id, puzzle]));
    const skillById = new Map(skillRows.map((skill) => [skill.id, skill]));

    type Metric = {
      attempts: number;
      successful: number;
      learners: Set<string>;
      evidenceTypes: Set<string>;
      mastered: { attempts: number; successful: number; learners: Set<string> };
      notMastered: { attempts: number; successful: number; learners: Set<string> };
    };
    const metrics = new Map<string, Metric>();
    for (const group of groups) {
      const key = `${group.puzzleId}:${group.skillId}`;
      const metric = metrics.get(key) ?? {
        attempts: 0,
        successful: 0,
        learners: new Set<string>(),
        evidenceTypes: new Set<string>(),
        mastered: { attempts: 0, successful: 0, learners: new Set<string>() },
        notMastered: { attempts: 0, successful: 0, learners: new Set<string>() },
      };
      const count = group._count._all;
      const mastered = statusByLearnerSkill.get(`${group.profileId}:${group.skillId}`) === 'MASTERED';
      metric.attempts += count;
      if (group.isCorrect) metric.successful += count;
      metric.learners.add(group.profileId);
      metric.evidenceTypes.add(group.evidenceType);
      const cohort = mastered ? metric.mastered : metric.notMastered;
      cohort.attempts += count;
      if (group.isCorrect) cohort.successful += count;
      cohort.learners.add(group.profileId);
      metrics.set(key, metric);
    }

    const tasks = [...metrics.entries()].map(([key, metric]) => {
      const [puzzleId, skillId] = key.split(':');
      const puzzle = puzzleById.get(puzzleId);
      const skill = skillById.get(skillId);
      const successRate = metric.attempts
        ? Math.round((metric.successful / metric.attempts) * 100)
        : null;
      const masteredRate = metric.mastered.attempts
        ? (metric.mastered.successful / metric.mastered.attempts) * 100
        : null;
      const notMasteredRate = metric.notMastered.attempts
        ? (metric.notMastered.successful / metric.notMastered.attempts) * 100
        : null;
      const separation = masteredRate !== null && notMasteredRate !== null
        ? Math.round(masteredRate - notMasteredRate)
        : null;
      const qualitySignals: string[] = [];
      if (metric.attempts > 0 && metric.attempts < 10) qualitySignals.push('LOW_SAMPLE_SIZE');
      if (metric.attempts >= 10 && metric.evidenceTypes.size === 1) qualitySignals.push('LOW_EVIDENCE_DIVERSITY');
      if (metric.attempts >= 10 && successRate !== null && successRate < 40) {
        qualitySignals.push('LOW_SUCCESS_RATE');
      }
      if (
        metric.mastered.attempts >= 5
        && metric.notMastered.attempts >= 5
        && separation !== null
        && Math.abs(separation) < 10
      ) {
        qualitySignals.push('LOW_MASTERY_SEPARATION');
      }
      return {
        puzzleId,
        puzzleOrder: puzzle?.orderNo ?? null,
        puzzleType: puzzle?.type ?? null,
        levelOrder: puzzle?.level.orderNo ?? null,
        levelTitle: puzzle?.level.title ?? null,
        questVersionId: puzzle?.level.questVersion.id ?? null,
        questVersion: puzzle?.level.questVersion.versionNo ?? null,
        questTitle: puzzle?.level.questVersion.title ?? null,
        questSlug: puzzle?.level.questVersion.quest.slug ?? null,
        skillId,
        skillKey: skill?.key ?? null,
        skillName: skill?.name ?? null,
        attempts: metric.attempts,
        successful: metric.successful,
        successRate,
        learners: metric.learners.size,
        evidenceTypeCount: metric.evidenceTypes.size,
        masteryDiscrimination: {
          mastered: {
            attempts: metric.mastered.attempts,
            learners: metric.mastered.learners.size,
            successRate: masteredRate === null ? null : Math.round(masteredRate),
          },
          notMastered: {
            attempts: metric.notMastered.attempts,
            learners: metric.notMastered.learners.size,
            successRate: notMasteredRate === null ? null : Math.round(notMasteredRate),
          },
          successRateGap: separation,
        },
        qualitySignals,
      };
    }).sort((left, right) => {
      const successRateOrder = (left.successRate ?? 101) - (right.successRate ?? 101);
      if (successRateOrder !== 0) return successRateOrder;
      const questOrder = (left.questSlug ?? '').localeCompare(right.questSlug ?? '');
      if (questOrder !== 0) return questOrder;
      const levelOrder = (left.levelOrder ?? 0) - (right.levelOrder ?? 0);
      return levelOrder || (left.puzzleOrder ?? 0) - (right.puzzleOrder ?? 0);
    });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        puzzleSkillPairs: tasks.length,
        attempts: tasks.reduce((sum, task) => sum + task.attempts, 0),
        learners: new Set(groups.map((group) => group.profileId)).size,
        flagged: tasks.filter((task) => task.qualitySignals.length > 0).length,
      },
      tasks,
      notes: {
        masteryCohorts: 'Mastery cohorts use each learner skill current status, not historical status at attempt time.',
        lowMasterySeparation: 'LOW_MASTERY_SEPARATION is evaluated only when both cohorts have at least five evidence observations.',
      },
    };
  }

  async createSkill(user: AuthenticatedUser, dto: CreateSkillDto): Promise<object> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockSkillGraph(tx);
        const id = randomUUID();
        await this.assertSkillPrerequisites(tx, id, dto.prerequisiteIds ?? []);
        const created = await tx.skill.create({
          data: {
            id,
            key: dto.key.trim(),
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            difficulty: dto.difficulty ?? null,
          },
        });
        if (dto.prerequisiteIds?.length) {
          await tx.skillPrerequisite.createMany({
            data: dto.prerequisiteIds.map((prerequisiteId) => ({
              skillId: created.id,
              prerequisiteId,
            })),
          });
        }
        const result = await tx.skill.findUnique({
          where: { id: created.id },
          include: {
            prerequisites: {
              include: {
                prerequisite: {
                  select: { id: true, key: true, name: true, description: true, difficulty: true },
                },
              },
            },
          },
        });
        if (!result) throw new NotFoundException('Created skill could not be reloaded.');
        await this.audit(tx, user.userId, 'skill.created', 'SKILL', created.id, undefined, {
          id: created.id,
          key: created.key,
          name: created.name,
          description: created.description,
          difficulty: created.difficulty,
          prerequisiteIds: dto.prerequisiteIds ?? [],
        });
        return {
          id: result.id,
          key: result.key,
          name: result.name,
          description: result.description,
          difficulty: result.difficulty,
          prerequisites: result.prerequisites.map((edge) => edge.prerequisite),
        };
      });
    } catch (error) {
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('A skill with this key already exists.');
      }
      throw error;
    }
  }

  async updateSkill(user: AuthenticatedUser, id: string, dto: UpdateSkillDto): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSkillGraph(tx);
      const current = await tx.skill.findUnique({
        where: { id },
        include: {
          prerequisites: {
            include: { prerequisite: { select: { id: true, key: true, name: true } } },
          },
        },
      });
      if (!current) throw new NotFoundException('Skill not found.');

      if (dto.name !== undefined && dto.name.trim() !== current.name) {
        const referenced = await tx.questVersion.findFirst({
          where: { skills: { has: current.name } },
          select: { id: true },
        });
        if (referenced) {
          throw new ConflictException(
            'A skill name cannot change after quest versions reference it. Keep the stable label or create a new skill.',
          );
        }
      }

      if (dto.prerequisiteIds !== undefined) {
        await this.assertSkillPrerequisites(tx, id, dto.prerequisiteIds);
        await tx.skillPrerequisite.deleteMany({ where: { skillId: id } });
        if (dto.prerequisiteIds.length) {
          await tx.skillPrerequisite.createMany({
            data: dto.prerequisiteIds.map((prerequisiteId) => ({
              skillId: id,
              prerequisiteId,
            })),
          });
        }
      }

      const updated = await tx.skill.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty || null } : {}),
        },
      });
      const result = await tx.skill.findUnique({
        where: { id },
        include: {
          prerequisites: {
            include: {
              prerequisite: {
                select: { id: true, key: true, name: true, description: true, difficulty: true },
              },
            },
          },
        },
      });
      if (!result) throw new NotFoundException('Updated skill could not be reloaded.');
      await this.audit(tx, user.userId, 'skill.updated', 'SKILL', id, {
        key: current.key,
        name: current.name,
        description: current.description,
        difficulty: current.difficulty,
        prerequisiteIds: current.prerequisites.map((edge) => edge.prerequisiteId),
      }, {
        key: updated.key,
        name: updated.name,
        description: updated.description,
        difficulty: updated.difficulty,
        prerequisiteIds: result.prerequisites.map((edge) => edge.prerequisiteId),
      });
      return {
        id: result.id,
        key: result.key,
        name: result.name,
        description: result.description,
        difficulty: result.difficulty,
        prerequisites: result.prerequisites.map((edge) => edge.prerequisite),
      };
    });
  }

  async createQuest(user: AuthenticatedUser, dto: CreateQuestDto): Promise<object> {
    this.validateQuestMetadata(dto);
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Choose an active published category.');

    return this.prisma.$transaction(async (tx) => {
      const skillNames = await this.resolveSkillNames(tx, dto.skills);
      const quest = await tx.quest.create({
        data: {
          categoryId: dto.categoryId,
          slug: dto.slug,
          status: 'DRAFT',
        },
      });
      const version = await tx.questVersion.create({
        data: {
          questId: quest.id,
          versionNo: 1,
          title: dto.title.trim(),
          summary: dto.summary.trim(),
          description: dto.description.trim(),
          internalName: dto.internalName?.trim() || null,
          objectives: jsonInput(dto.objectives),
          skills: skillNames,
          ageMin: dto.ageMin,
          ageMax: dto.ageMax,
          difficulty: dto.difficulty,
          durationMin: dto.durationMin,
          locale: dto.locale,
          seo: jsonInput(dto.seo),
          coverUrl: dto.coverUrl,
          coverAlt: dto.coverAlt.trim(),
          coverLicenseSource: dto.coverLicenseSource.trim(),
          authorId: user.userId,
          status: 'DRAFT',
        },
      });
      await this.createLevels(tx, version.id, dto.levels);
      const after = { questId: quest.id, versionId: version.id, slug: quest.slug, status: version.status };
      await this.audit(tx, user.userId, 'quest.created', 'QUEST', quest.id, undefined, after);
      return { id: quest.id, slug: quest.slug, version: version.versionNo, status: version.status };
    });
  }

  async updateQuest(user: AuthenticatedUser, id: string, dto: UpdateQuestDto): Promise<object> {
    const currentQuest = await this.prisma.quest.findUnique({ where: { id } });
    if (!currentQuest) throw new NotFoundException('Quest not found.');

    const version = await this.prisma.questVersion.findFirst({
      where: { questId: id, status: { in: [...EDITABLE_STATUSES] } },
      orderBy: { versionNo: 'desc' },
    });
    if (!version) {
      throw new ConflictException('Create a new draft version before editing this quest.');
    }
    if (!canManageQuestDraft(user, version.authorId)) {
      throw new ForbiddenException('You can only edit your own draft. Ask an administrator to reassign the draft.');
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (!category) throw new BadRequestException('Choose an active published category.');
    }
    const latestAge = await this.prisma.questVersion.findFirst({
      where: { questId: id },
      orderBy: { versionNo: 'desc' },
      select: { ageMin: true, ageMax: true },
    });
    if (latestAge && (dto.ageMin ?? latestAge.ageMin) > (dto.ageMax ?? latestAge.ageMax)) {
      throw new BadRequestException('Minimum age cannot exceed maximum age.');
    }
    if (dto.coverUrl !== undefined) this.validateCover(dto.coverUrl);
    if (dto.slug !== undefined) {
      const published = await this.prisma.questVersion.findFirst({
        where: { questId: id, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (published) throw new ConflictException('A public quest slug cannot be changed after the first publication.');
    }

    return this.prisma.$transaction(async (tx) => {
      const lockedVersion = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "quest_versions"
        WHERE "id" = ${version.id}::uuid
          AND "status" = 'DRAFT'
        FOR UPDATE
      `;
      if (lockedVersion.length !== 1) {
        throw new ConflictException('The draft is no longer editable. Reload the quest and try again.');
      }
      const currentDraft = await this.getLatestDraftVersion(id, tx);
      if (currentDraft.id !== version.id) {
        throw new ConflictException('The current draft changed. Reload the quest and try again.');
      }
      // Re-check author ownership after locking the row to close reassignment races.
      if (!canManageQuestDraft(user, currentDraft.authorId)) {
        throw new ForbiddenException('You can only edit your own draft. Ask an administrator to reassign the draft.');
      }
      if ((dto.ageMin ?? currentDraft.ageMin) > (dto.ageMax ?? currentDraft.ageMax)) {
        throw new BadRequestException('Minimum age cannot exceed maximum age.');
      }

      const skillNames = dto.skills !== undefined
        ? await this.resolveSkillNames(tx, dto.skills)
        : undefined;
      const updatedQuest = await tx.quest.update({
        where: { id },
        data: {
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        },
      });
      const updatedVersion = await tx.questVersion.update({
        where: { id: version.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.summary !== undefined ? { summary: dto.summary.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.internalName !== undefined ? { internalName: dto.internalName.trim() || null } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.objectives !== undefined ? { objectives: jsonInput(dto.objectives) } : {}),
          ...(skillNames !== undefined ? { skills: skillNames } : {}),
          ...(dto.ageMin !== undefined ? { ageMin: dto.ageMin } : {}),
          ...(dto.ageMax !== undefined ? { ageMax: dto.ageMax } : {}),
          ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
          ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin } : {}),
          ...(dto.seo !== undefined ? { seo: jsonInput(dto.seo) } : {}),
          ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
          ...(dto.coverAlt !== undefined ? { coverAlt: dto.coverAlt.trim() } : {}),
          ...(dto.coverLicenseSource !== undefined ? { coverLicenseSource: dto.coverLicenseSource.trim() } : {}),
        },
      });
      if (dto.levels !== undefined) {
        await tx.hint.deleteMany({ where: { puzzle: { level: { questVersionId: version.id } } } });
        await tx.puzzle.deleteMany({ where: { level: { questVersionId: version.id } } });
        await tx.level.deleteMany({ where: { questVersionId: version.id } });
        await this.createLevels(tx, version.id, dto.levels);
      }
      await this.audit(tx, user.userId, 'quest.draft.updated', 'QUEST', id, currentQuest, {
        questId: updatedQuest.id,
        slug: updatedQuest.slug,
        versionId: updatedVersion.id,
        title: updatedVersion.title,
        status: updatedVersion.status,
      });
      return { id, slug: updatedQuest.slug, version: updatedVersion.versionNo, status: updatedVersion.status };
    });
  }

  async createDraft(user: AuthenticatedUser, id: string): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      const quest = await tx.quest.findUnique({
        where: { id },
        include: {
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            include: {
              levels: {
                orderBy: { orderNo: 'asc' },
                include: {
                  puzzles: {
                    orderBy: { orderNo: 'asc' },
                    include: { hints: { orderBy: { orderNo: 'asc' } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!quest) throw new NotFoundException('Quest not found.');
      const source = quest.versions[0];
      if (!source) throw new ConflictException('Quest has no version to duplicate.');
      if (source.status === 'DRAFT' || source.status === 'REVIEW' || source.status === 'APPROVED') {
        throw new ConflictException('Finish or withdraw the current draft before creating another.');
      }

      const maxVersion = await tx.questVersion.aggregate({
        where: { questId: id },
        _max: { versionNo: true },
      });
      const newVersion = await tx.questVersion.create({
        data: {
          questId: id,
          versionNo: (maxVersion._max.versionNo ?? 0) + 1,
          title: source.title,
          summary: source.summary,
          description: source.description,
          internalName: source.internalName,
          objectives: jsonInput(source.objectives),
          skills: source.skills,
          ageMin: source.ageMin,
          ageMax: source.ageMax,
          difficulty: source.difficulty,
          durationMin: source.durationMin,
          locale: source.locale,
          ...(source.seo !== null ? { seo: jsonInput(source.seo) } : {}),
          coverUrl: source.coverUrl,
          coverAlt: source.coverAlt,
          coverLicenseSource: source.coverLicenseSource,
          authorId: user.userId,
          status: 'DRAFT',
        },
      });
      const levels: LevelInputDto[] = source.levels.map((level) => ({
        orderNo: level.orderNo,
        title: level.title,
        intro: level.intro,
        puzzles: level.puzzles.map((puzzle) => ({
          orderNo: puzzle.orderNo,
          type: puzzle.type,
          maxAttempts: puzzle.maxAttempts,
          maxScore: puzzle.maxScore,
          publicPayload: puzzle.publicPayload as Record<string, unknown>,
          solutionPrivate: puzzle.solutionPrivate as Record<string, unknown>,
          hints: puzzle.hints.map((hint) => hint.body),
        })),
      }));
      await this.createLevels(tx, newVersion.id, levels);
      await this.audit(tx, user.userId, 'quest.draft.created_from_version', 'QUEST', id, {
        sourceVersion: source.versionNo,
      }, { versionId: newVersion.id, versionNo: newVersion.versionNo });
      return { id, versionId: newVersion.id, versionNo: newVersion.versionNo, status: newVersion.status };
    });
  }

  async submitForReview(user: AuthenticatedUser, id: string): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      let version = await this.getLatestDraftVersion(id, tx);
      const lockedVersion = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "quest_versions"
        WHERE "id" = ${version.id}::uuid
          AND "status" = 'DRAFT'
        FOR UPDATE
      `;
      if (lockedVersion.length !== 1) {
        throw new ConflictException('The draft is no longer available for review. Reload the quest and try again.');
      }

      // Re-read under the lock so the ownership and readiness checks use the
      // same current draft that will be transitioned.
      version = await this.getLatestDraftVersion(id, tx);
      if (version.id !== lockedVersion[0]!.id) {
        throw new ConflictException('The current draft changed. Reload the quest and try again.');
      }
      if (!canManageQuestDraft(user, version.authorId)) {
        throw new ForbiddenException('Only the draft author or an administrator can submit this version for review.');
      }
      const readiness = await this.checkPublishReadiness(version);
      if (readiness.errors.length) {
        throw new BadRequestException({ message: 'Quest is not ready for review.', errors: readiness.errors });
      }

      const transitioned = await tx.questVersion.updateMany({
        where: { id: version.id, status: 'DRAFT' },
        data: {
          status: 'REVIEW',
          reviewerId: null,
          reviewFeedback: null,
          approvedAt: null,
          approvedById: null,
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('The draft is no longer available for review. Reload the quest and try again.');
      }
      const updated = await tx.questVersion.findUnique({ where: { id: version.id } });
      if (!updated) throw new ConflictException('The submitted version could not be reloaded.');

      await this.audit(tx, user.userId, 'quest.submitted_for_review', 'QUEST', id, version, {
        versionId: updated.id, versionNo: updated.versionNo, status: updated.status,
      });
      return { id, versionId: updated.id, versionNo: updated.versionNo, status: updated.status };
    });
  }

  async assignQuestReviewer(
    actor: AuthenticatedUser,
    questId: string,
    reviewerId: string | null,
  ): Promise<object> {
    if (!canViewAllQuestVersions(actor)) {
      throw new ForbiddenException('Only reviewers and administrators can assign quest reviewers.');
    }

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId, status: 'REVIEW' },
        orderBy: { versionNo: 'desc' },
        select: {
          id: true,
          questId: true,
          versionNo: true,
          status: true,
          authorId: true,
          reviewerId: true,
        },
      });
      if (!version) throw new ConflictException('A quest in REVIEW state was not found.');

      const reviewer = reviewerId
        ? await tx.user.findFirst({
          where: {
            id: reviewerId,
            status: 'ACTIVE',
            roles: { some: { role: { key: { in: ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'] } } } },
          },
          select: {
            id: true,
            emailNormalized: true,
            profile: { select: { nickname: true } },
          },
        })
        : null;
      if (reviewerId && !reviewer) {
        throw new BadRequestException('Choose an active user with a reviewer or administrator role.');
      }
      if (reviewer && version.authorId === reviewer.id) {
        throw new ConflictException('The quest author cannot review their own version.');
      }

      if (version.reviewerId === reviewerId) {
        return {
          id: questId,
          versionId: version.id,
          versionNo: version.versionNo,
          status: version.status,
          reviewerId,
          reviewer: reviewer ? {
            id: reviewer.id,
            email: reviewer.emailNormalized,
            nickname: reviewer.profile?.nickname ?? null,
          } : null,
          changed: false,
        };
      }

      const updated = await tx.questVersion.updateMany({
        where: { id: version.id, status: 'REVIEW' },
        data: { reviewerId },
      });
      if (updated.count !== 1) {
        throw new ConflictException('This quest version has already left the review queue. Refresh the editorial queue.');
      }

      await this.audit(tx, actor.userId, 'quest.reviewer.assigned', 'QUEST', questId, {
        versionId: version.id,
        versionNo: version.versionNo,
        reviewerId: version.reviewerId,
      }, {
        versionId: version.id,
        versionNo: version.versionNo,
        reviewerId,
        reviewerEmail: reviewer?.emailNormalized ?? null,
      });

      return {
        id: questId,
        versionId: version.id,
        versionNo: version.versionNo,
        status: version.status,
        reviewerId,
        reviewer: reviewer ? {
          id: reviewer.id,
          email: reviewer.emailNormalized,
          nickname: reviewer.profile?.nickname ?? null,
        } : null,
        changed: true,
      };
    });
  }

  async requestQuestChanges(user: AuthenticatedUser, id: string, feedback: string): Promise<object> {
    const comment = feedback.trim();
    if (comment.length < 10 || comment.length > 2000) {
      throw new BadRequestException('Review feedback must contain between 10 and 2000 characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId: id, status: 'REVIEW' },
        orderBy: { versionNo: 'desc' },
      });
      if (!version) throw new ConflictException('A quest in REVIEW state was not found.');
      if (!version.authorId) {
        throw new ConflictException('This quest version has no assigned author to receive review feedback.');
      }
      if (version.authorId === user.userId) {
        throw new ForbiddenException('Authors cannot request changes to their own content.');
      }

      const transitioned = await tx.questVersion.updateMany({
        where: { id: version.id, status: 'REVIEW' },
        data: {
          status: 'DRAFT',
          reviewerId: user.userId,
          reviewFeedback: comment,
          approvedAt: null,
          approvedById: null,
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('This quest version has already been reviewed. Refresh the editorial queue.');
      }
      const updated = await tx.questVersion.findUnique({ where: { id: version.id } });
      if (!updated) throw new ConflictException('The returned quest version could not be reloaded.');

      await this.audit(tx, user.userId, 'quest.returned_for_revision', 'QUEST', id, {
        versionId: version.id,
        versionNo: version.versionNo,
        status: version.status,
      }, {
        versionId: updated.id,
        versionNo: updated.versionNo,
        status: updated.status,
        feedback: comment,
      }, comment);
      await this.notifyQuestAuthor(tx, {
        authorId: version.authorId,
        questId: id,
        questVersionId: version.id,
        type: 'CHANGES_REQUESTED',
        message: comment,
      });
      return {
        id,
        versionId: updated.id,
        versionNo: updated.versionNo,
        status: updated.status,
      };
    });
  }

  async approveQuest(user: AuthenticatedUser, id: string): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId: id, status: 'REVIEW' },
        orderBy: { versionNo: 'desc' },
      });
      if (!version) throw new ConflictException('A quest in REVIEW state was not found.');
      if (version.authorId && version.authorId === user.userId) {
        throw new ForbiddenException('Authors cannot approve their own content.');
      }
      const transitioned = await tx.questVersion.updateMany({
        where: { id: version.id, status: 'REVIEW' },
        data: {
          status: 'APPROVED',
          reviewerId: user.userId,
          reviewFeedback: null,
          approvedById: user.userId,
          approvedAt: new Date(),
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('This quest version has already been reviewed. Refresh the editorial queue.');
      }
      const updated = await tx.questVersion.findUnique({ where: { id: version.id } });
      if (!updated) throw new ConflictException('The approved quest version could not be reloaded.');

      await this.audit(tx, user.userId, 'quest.approved', 'QUEST', id, {
        versionId: version.id, status: version.status,
      }, { versionId: updated.id, status: updated.status, reviewerId: user.userId });
      await this.notifyQuestAuthor(tx, {
        authorId: version.authorId,
        questId: id,
        questVersionId: version.id,
        type: 'APPROVED',
        message: `Версия v${version.versionNo} одобрена и ожидает публикации.`,
      });
      return { id, versionId: updated.id, versionNo: updated.versionNo, status: updated.status };
    });
  }

  async publishQuest(user: AuthenticatedUser, id: string): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId: id, status: 'APPROVED' },
        orderBy: { versionNo: 'desc' },
        include: {
          levels: {
            orderBy: { orderNo: 'asc' },
            include: {
              puzzles: { orderBy: { orderNo: 'asc' }, include: { hints: true } },
            },
          },
          quest: { include: { category: true } },
        },
      });
      if (!version) throw new ConflictException('Only an approved version can be published.');
      if (!version.approvedAt || !version.approvedById) {
        throw new ConflictException('The version must be approved by a reviewer before publication.');
      }
      if (version.authorId === version.approvedById) {
        throw new ConflictException('Author and reviewer must be different users.');
      }
      const quest = await tx.quest.findUnique({
        where: { id },
        include: { category: true },
      });
      if (!quest) throw new NotFoundException('Quest not found.');
      if (quest.category.status !== 'PUBLISHED') {
        throw new ConflictException('The quest category must be published first.');
      }
      const readiness = await this.checkPublishReadiness(version, tx);
      if (readiness.errors.length) {
        throw new ConflictException({
          message: 'The approved quest version no longer satisfies publication readiness.',
          errors: readiness.errors,
        });
      }

      const transitioned = await tx.questVersion.updateMany({
        where: { id: version.id, status: 'APPROVED' },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: user.userId,
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('This quest version has already been published. Refresh the editorial queue.');
      }
      const updatedVersion = await tx.questVersion.findUnique({ where: { id: version.id } });
      if (!updatedVersion) throw new ConflictException('The published quest version could not be reloaded.');
      await tx.quest.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await this.audit(tx, user.userId, 'quest.published', 'QUEST', id, {
        versionId: version.id, status: version.status,
      }, {
        versionId: updatedVersion.id, versionNo: updatedVersion.versionNo, status: updatedVersion.status,
      });
      await this.notifyQuestAuthor(tx, {
        authorId: version.authorId,
        questId: id,
        questVersionId: version.id,
        type: 'PUBLISHED',
        message: `Версия v${version.versionNo} опубликована и доступна в каталоге.`,
      });
      return { id, versionId: updatedVersion.id, versionNo: updatedVersion.versionNo, status: updatedVersion.status };
    });
  }

  async listEditorialNotifications(user: AuthenticatedUser): Promise<object> {
    const where = { recipientId: user.userId };
    const [items, unreadCount] = await this.prisma.$transaction([
      this.prisma.questEditorialNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          type: true,
          message: true,
          readAt: true,
          createdAt: true,
          quest: { select: { id: true, slug: true } },
          questVersion: { select: { id: true, versionNo: true, title: true } },
        },
      }),
      this.prisma.questEditorialNotification.count({
        where: { ...where, readAt: null },
      }),
    ]);
    return { items, unreadCount };
  }

  async markEditorialNotificationRead(user: AuthenticatedUser, id: string): Promise<object> {
    const updated = await this.prisma.questEditorialNotification.updateMany({
      where: { id, recipientId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 1) return { id, read: true, changed: true };

    const existing = await this.prisma.questEditorialNotification.findFirst({
      where: { id, recipientId: user.userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Notification not found.');
    return { id, read: true, changed: false };
  }

  async markAllEditorialNotificationsRead(user: AuthenticatedUser): Promise<object> {
    const updated = await this.prisma.questEditorialNotification.updateMany({
      where: { recipientId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updatedCount: updated.count };
  }

  async listAuditLogs(
    filters: AuditLogFilters,
    take = 30,
    skip = 0,
  ): Promise<object> {
    const where = buildAuditLogWhere(filters);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          beforeJson: true,
          afterJson: true,
          reason: true,
          createdAt: true,
          actor: { select: { emailNormalized: true } },
        },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return { items, total, take, skip };
  }

  async exportAuditLogs(filters: AuditLogFilters): Promise<object> {
    const where = buildAuditLogWhere(filters);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: AUDIT_LOG_EXPORT_LIMIT,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          beforeJson: true,
          afterJson: true,
          reason: true,
          createdAt: true,
          actor: { select: { emailNormalized: true } },
        },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      items,
      total,
      exported: items.length,
      limit: AUDIT_LOG_EXPORT_LIMIT,
      truncated: total > items.length,
    };
  }



  async listUsers(search?: string): Promise<object[]> {
    const term = search?.trim();
    const users = await this.prisma.user.findMany({
      where: term
        ? {
            OR: [
              { emailNormalized: { contains: term, mode: 'insensitive' } },
              { profile: { is: { nickname: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        emailNormalized: true,
        status: true,
        emailVerifiedAt: true,
        mfaEnabledAt: true,
        createdAt: true,
        profile: { select: { nickname: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.emailNormalized,
      nickname: user.profile?.nickname ?? null,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      mfaEnabled: Boolean(user.mfaEnabledAt),
      createdAt: user.createdAt,
      roles: user.roles
        .map((entry) => ({ key: entry.role.key, name: entry.role.name }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }

  async assignUserRole(
    actor: AuthenticatedUser,
    targetUserId: string,
    roleKey: string,
    reason: string,
  ): Promise<object> {
    if (isSelfManagement(actor.userId, targetUserId)) {
      throw new ForbiddenException('You cannot change your own account roles.');
    }
    const allowedRoles = ['AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'];
    if (!allowedRoles.includes(roleKey)) {
      throw new BadRequestException('Unknown role key.');
    }
    const auditReason = reason.trim();
    if (auditReason.length < 5) {
      throw new BadRequestException('Provide a reason with at least five characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904219)`;
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, emailNormalized: true, status: true },
      });
      if (!target) throw new NotFoundException('User not found.');
      const role = await tx.role.findUnique({ where: { key: roleKey } });
      if (!role) throw new NotFoundException('Role definition not found; run the database seed.');

      const existing = await tx.userRole.findUnique({
        where: { userId_roleId: { userId: targetUserId, roleId: role.id } },
      });
      if (existing) throw new ConflictException('This user already has the selected role.');

      await tx.userRole.create({ data: { userId: targetUserId, roleId: role.id } });
      await this.audit(
        tx,
        actor.userId,
        'security.role.granted',
        'USER',
        targetUserId,
        { email: target.emailNormalized },
        { email: target.emailNormalized, role: role.key },
        auditReason,
      );

      return { userId: targetUserId, email: target.emailNormalized, role: role.key, granted: true };
    }, { isolationLevel: 'Serializable' });
  }

  async removeUserRole(
    actor: AuthenticatedUser,
    targetUserId: string,
    roleKey: string,
    reason: string,
  ): Promise<object> {
    if (isSelfManagement(actor.userId, targetUserId)) {
      throw new ForbiddenException('You cannot change your own account roles.');
    }
    const allowedRoles = ['AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN'];
    if (!allowedRoles.includes(roleKey)) {
      throw new BadRequestException('Unknown role key.');
    }
    const auditReason = reason.trim();
    if (auditReason.length < 5) {
      throw new BadRequestException('Provide a reason with at least five characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904219)`;
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          emailNormalized: true,
          status: true,
          roles: { select: { role: { select: { key: true, id: true } } } },
        },
      });
      if (!target) throw new NotFoundException('User not found.');
      const role = target.roles.find((entry) => entry.role.key === roleKey)?.role;
      if (!role) throw new NotFoundException('User does not have this role.');

      if (roleKey === 'SUPER_ADMIN' && target.status === 'ACTIVE') {
        const activeSuperAdminCount = await tx.userRole.count({
          where: {
            roleId: role.id,
            user: { is: { status: 'ACTIVE' } },
          },
        });
        if (wouldRemoveLastActiveSuperAdmin(
          target.roles.map((entry) => entry.role.key),
          target.status,
          activeSuperAdminCount,
        )) {
          throw new ConflictException('The last active Super Admin role cannot be removed.');
        }
      }

      await tx.userRole.delete({
        where: { userId_roleId: { userId: targetUserId, roleId: role.id } },
      });
      await this.audit(
        tx,
        actor.userId,
        'security.role.revoked',
        'USER',
        targetUserId,
        { email: target.emailNormalized, role: roleKey },
        { email: target.emailNormalized, role: roleKey, revoked: true },
        auditReason,
      );
      return { userId: targetUserId, email: target.emailNormalized, role: roleKey, revoked: true };
    }, { isolationLevel: 'Serializable' });
  }

  async listUserSessions(actor: AuthenticatedUser, targetUserId: string): Promise<object> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, emailNormalized: true, status: true },
    });
    if (!target) throw new NotFoundException('User not found.');

    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: { userId: targetUserId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, mfaVerifiedAt: true },
    });

    return {
      userId: target.id,
      email: target.emailNormalized,
      status: target.status,
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        mfaVerified: Boolean(session.mfaVerifiedAt),
        isCurrent: session.id === actor.sessionId,
      })),
    };
  }

  async revokeUserSession(
    actor: AuthenticatedUser,
    targetUserId: string,
    sessionId: string,
    reason: string,
  ): Promise<object> {
    if (actor.userId === targetUserId && actor.sessionId === sessionId) {
      throw new ForbiddenException('You cannot revoke the current session.');
    }
    const auditReason = reason.trim();
    if (auditReason.length < 5) {
      throw new BadRequestException('Provide a reason with at least five characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, emailNormalized: true },
      });
      if (!target) throw new NotFoundException('User not found.');

      const now = new Date();
      const session = await tx.session.findFirst({
        where: { id: sessionId, userId: targetUserId, expiresAt: { gt: now } },
        select: { id: true, createdAt: true, expiresAt: true },
      });
      if (!session) throw new NotFoundException('Active session not found.');

      const deleted = await tx.session.deleteMany({
        where: { id: sessionId, userId: targetUserId, expiresAt: { gt: now } },
      });
      if (deleted.count !== 1) throw new NotFoundException('Active session not found.');

      await this.audit(
        tx,
        actor.userId,
        'security.user_session.revoked',
        'USER',
        targetUserId,
        { email: target.emailNormalized, sessionId, createdAt: session.createdAt },
        { email: target.emailNormalized, sessionId, revoked: true },
        auditReason,
      );
      return { userId: targetUserId, sessionId, revoked: true };
    });
  }

  async revokeOtherUserSessions(
    actor: AuthenticatedUser,
    targetUserId: string,
    reason: string,
  ): Promise<object> {
    const auditReason = reason.trim();
    if (auditReason.length < 5) {
      throw new BadRequestException('Provide a reason with at least five characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, emailNormalized: true },
      });
      if (!target) throw new NotFoundException('User not found.');

      const now = new Date();
      const isSelf = actor.userId === targetUserId;
      const deleted = await tx.session.deleteMany({
        where: {
          userId: targetUserId,
          expiresAt: { gt: now },
          ...(isSelf ? { id: { not: actor.sessionId } } : {}),
        },
      });

      if (deleted.count > 0) {
        await this.audit(
          tx,
          actor.userId,
          'security.user_sessions.revoked',
          'USER',
          targetUserId,
          { email: target.emailNormalized, activeSessions: deleted.count },
          { email: target.emailNormalized, revokedSessions: deleted.count, currentSessionPreserved: isSelf },
          auditReason,
        );
      }

      return {
        userId: targetUserId,
        email: target.emailNormalized,
        revokedCount: deleted.count,
        currentSessionPreserved: isSelf,
      };
    });
  }

  async updateUserStatus(
    actor: AuthenticatedUser,
    targetUserId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    reason: string,
  ): Promise<object> {
    if (isSelfManagement(actor.userId, targetUserId)) {
      throw new ForbiddenException('You cannot change your own account status.');
    }
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      throw new BadRequestException('Only ACTIVE and SUSPENDED statuses can be assigned.');
    }
    const auditReason = reason.trim();
    if (auditReason.length < 5) {
      throw new BadRequestException('Provide a reason with at least five characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904219)`;
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          emailNormalized: true,
          status: true,
          roles: { select: { role: { select: { key: true, id: true } } } },
        },
      });
      if (!target) throw new NotFoundException('User not found.');
      if (target.status === status) {
        return { userId: targetUserId, email: target.emailNormalized, status, changed: false };
      }

      if (status === 'SUSPENDED') {
        const superAdmin = target.roles.find((entry) => entry.role.key === 'SUPER_ADMIN')?.role;
        if (superAdmin && target.status === 'ACTIVE') {
          const activeSuperAdminCount = await tx.userRole.count({
            where: { roleId: superAdmin.id, user: { is: { status: 'ACTIVE' } } },
          });
          if (wouldRemoveLastActiveSuperAdmin(
            target.roles.map((entry) => entry.role.key),
            target.status,
            activeSuperAdminCount,
          )) {
            throw new ConflictException('The last active Super Admin account cannot be suspended.');
          }
        }
      }

      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status },
      });
      if (status === 'SUSPENDED') {
        await tx.session.deleteMany({ where: { userId: targetUserId } });
      }
      await this.audit(
        tx,
        actor.userId,
        status === 'SUSPENDED' ? 'security.user.suspended' : 'security.user.reactivated',
        'USER',
        targetUserId,
        { email: target.emailNormalized, status: target.status },
        { email: target.emailNormalized, status: updated.status },
        auditReason,
      );
      return { userId: targetUserId, email: target.emailNormalized, status: updated.status, changed: true };
    }, { isolationLevel: 'Serializable' });
  }

  private validateQuestMetadata(dto: CreateQuestDto): void {
    if (dto.ageMin > dto.ageMax) throw new BadRequestException('Minimum age cannot exceed maximum age.');
    this.validateCover(dto.coverUrl);
  }

  private validateCover(url: string): void {
    if (!(url.startsWith('/media/') || url.startsWith('https://'))) {
      throw new BadRequestException('Cover must use an HTTPS URL or a /media/ storage path.');
    }
  }

  private async createLevels(tx: Transaction, versionId: string, levels: LevelInputDto[]): Promise<void> {
    const levelOrders = new Set<number>();
    for (const levelInput of levels) {
      if (levelOrders.has(levelInput.orderNo)) throw new BadRequestException('Level order numbers must be unique.');
      levelOrders.add(levelInput.orderNo);
      const level = await tx.level.create({
        data: {
          questVersionId: versionId,
          orderNo: levelInput.orderNo,
          title: levelInput.title.trim(),
          intro: levelInput.intro.trim(),
        },
      });
      const puzzleOrders = new Set<number>();
      for (const puzzleInput of levelInput.puzzles) {
        if (puzzleOrders.has(puzzleInput.orderNo)) {
          throw new BadRequestException('Puzzle order numbers must be unique within each level.');
        }
        puzzleOrders.add(puzzleInput.orderNo);
        const puzzle = await tx.puzzle.create({
          data: {
            levelId: level.id,
            orderNo: puzzleInput.orderNo,
            type: puzzleInput.type,
            maxAttempts: puzzleInput.maxAttempts,
            maxScore: puzzleInput.maxScore,
            publicPayload: jsonInput(puzzleInput.publicPayload),
            solutionPrivate: jsonInput(puzzleInput.solutionPrivate),
          },
        });
        await tx.hint.createMany({
          data: puzzleInput.hints.map((body, index) => ({
            id: randomUUID(),
            puzzleId: puzzle.id,
            orderNo: index + 1,
            body: body.trim(),
          })),
        });
      }
    }
  }

  private async getLatestDraftVersion(
    questId: string,
    client: Pick<Prisma.TransactionClient, 'questVersion'> = this.prisma,
  ) {
    const version = await client.questVersion.findFirst({
      where: { questId, status: 'DRAFT' },
      orderBy: { versionNo: 'desc' },
      include: {
        levels: {
          orderBy: { orderNo: 'asc' },
          include: {
            puzzles: { orderBy: { orderNo: 'asc' }, include: { hints: true } },
          },
        },
        quest: { include: { category: true } },
      },
    });
    if (!version) throw new ConflictException('A draft version was not found.');
    return version;
  }

  private async checkPublishReadiness(
    version: Awaited<ReturnType<AdminService['getLatestDraftVersion']>>,
    client: Pick<Transaction, 'skill' | 'skillPrerequisite'> = this.prisma,
  ) {
    const errors: string[] = [];
    if (!version.title.trim()) errors.push('Title is required.');
    if (version.summary.trim().length < 20) errors.push('Summary must contain at least 20 characters.');
    if (version.description.trim().length < 50) errors.push('Description must contain at least 50 characters.');
    const objectives = Array.isArray(version.objectives)
      ? version.objectives.filter((value): value is string => typeof value === 'string')
      : [];
    if (objectives.length < 2 || objectives.length > 4) {
      errors.push('Provide 2–4 learning objectives.');
    }
    if (version.skills.length < 1) {
      errors.push('Select at least one skill.');
    }

    const labels = version.skills.map((skill) => skill.trim());
    const catalog = labels.length
      ? await client.skill.findMany({
          select: { id: true, key: true, name: true },
        })
      : [];
    const byLabel = labels.map((label) => {
      const key = normalizeSkillKey(label);
      return catalog.find((skill) => (
        skill.key === key || skill.name === label || normalizeSkillKey(skill.name) === key
      ));
    });
    const unknown = labels.filter((_, index) => !byLabel[index]);
    if (unknown.length) errors.push(`Unknown skills in this quest: ${unknown.join(', ')}.`);

    for (const skill of byLabel) {
      if (!skill) continue;
      const skillPhrase = normalizeSkillText(skill.name);
      const linked = objectives.some((objective) => {
        const objectiveText = `-${normalizeSkillText(objective)}-`;
        return objectiveText.includes(`-${skillPhrase}-`);
      });
      if (!linked) {
        errors.push(`Learning objective must explicitly cover skill "${skill.name}". Mention the skill name in at least one objective.`);
      }
    }

    const puzzles = version.levels.flatMap((level) => level.puzzles);
    const taskTypes = new Set(puzzles.map((puzzle) => puzzle.type));
    for (const skill of byLabel) {
      if (!skill) continue;
      if (puzzles.length < 3) {
        errors.push(`Skill "${skill.name}": at least 3 distinct puzzles are required to collect mastery evidence (found ${puzzles.length}).`);
      }
      if (taskTypes.size < 2) {
        errors.push(`Skill "${skill.name}": at least 2 task types are required to collect diverse mastery evidence (found ${taskTypes.size}).`);
      }
    }

    if (byLabel.some(Boolean)) {
      const edges = await client.skillPrerequisite.findMany({
        select: { skillId: true, prerequisiteId: true },
      });
      const skillIds = new Set(catalog.map((skill) => skill.id));
      const prerequisitesBySkill = new Map<string, string[]>();
      for (const edge of edges) {
        if (!skillIds.has(edge.skillId) || !skillIds.has(edge.prerequisiteId)) {
          errors.push('Skill prerequisite graph contains a reference to a missing catalog skill.');
          continue;
        }
        const list = prerequisitesBySkill.get(edge.skillId) ?? [];
        list.push(edge.prerequisiteId);
        prerequisitesBySkill.set(edge.skillId, list);
      }

      const catalogById = new Map(catalog.map((skill) => [skill.id, skill]));
      const visited = new Set<string>();
      const active = new Set<string>();
      const visit = (skillId: string): void => {
        if (active.has(skillId)) {
          const skill = catalogById.get(skillId);
          errors.push(`Skill prerequisite chain contains a cycle at "${skill?.name ?? skillId}".`);
          return;
        }
        if (visited.has(skillId)) return;
        active.add(skillId);
        for (const prerequisiteId of prerequisitesBySkill.get(skillId) ?? []) {
          visit(prerequisiteId);
        }
        active.delete(skillId);
        visited.add(skillId);
      };
      for (const skill of byLabel) {
        if (skill) visit(skill.id);
      }
    }

    if (version.ageMin < 14 || version.ageMin > version.ageMax) errors.push('Age range is invalid.');
    if (!version.locale || !version.difficulty || version.durationMin < 1) errors.push('Locale, difficulty and duration are required.');
    const seo = version.seo && typeof version.seo === 'object' && !Array.isArray(version.seo)
      ? version.seo as Record<string, unknown>
      : {};
    if (typeof seo.title !== 'string' || seo.title.trim().length < 5) errors.push('SEO title is required.');
    if (typeof seo.description !== 'string' || seo.description.trim().length < 20) errors.push('SEO description is required.');
    if (!version.coverUrl || !version.coverAlt?.trim() || !version.coverLicenseSource?.trim()) {
      errors.push('Cover URL, alt text and license source are required.');
    } else if (!(version.coverUrl.startsWith('/media/') || version.coverUrl.startsWith('https://'))) {
      errors.push('Cover must use an HTTPS URL or a /media/ storage path.');
    }
    if (version.quest.category.status !== 'PUBLISHED') errors.push('The selected category is not published.');
    if (version.levels.length < 1) errors.push('At least one level is required.');

    let puzzleCount = 0;
    for (const level of version.levels) {
      if (!level.title.trim() || !level.intro.trim()) errors.push(`Level ${level.orderNo}: title and intro are required.`);
      if (!level.puzzles.length) errors.push(`Level ${level.orderNo}: at least one puzzle is required.`);
      for (const puzzle of level.puzzles) {
        puzzleCount += 1;
        if (!puzzle.hints.length) errors.push(`Puzzle ${puzzle.orderNo}: add at least one hint.`);
        const solution = puzzle.solutionPrivate && typeof puzzle.solutionPrivate === 'object' && !Array.isArray(puzzle.solutionPrivate)
          ? puzzle.solutionPrivate as Record<string, unknown>
          : {};
        if (typeof solution.correctFeedback !== 'string' || solution.correctFeedback.trim().length < 5) {
          errors.push(`Puzzle ${puzzle.orderNo}: an explanation for the correct answer is required.`);
        }
        try {
          validatePuzzleAnswer(
            puzzle.type,
            puzzle.publicPayload,
            puzzle.solutionPrivate,
            puzzleAnswerForDefinition(puzzle.type, solution),
          );
        } catch (error) {
          errors.push(`Puzzle ${puzzle.orderNo}: ${error instanceof Error ? error.message : 'invalid puzzle definition'}`);
        }
      }
    }
    if (puzzleCount < 1) errors.push('At least one puzzle is required.');
    return { errors };
  }

  private async resolveSkillNames(tx: Transaction, values: string[]): Promise<string[]> {
    const normalized = values.map(normalizeSkillKey);
    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException('Select each skill only once.');
    }
    const skills = await tx.skill.findMany({
      where: {
        OR: [
          { key: { in: normalized } },
          { name: { in: values.map((value) => value.trim()) } },
        ],
      },
      select: { id: true, key: true, name: true },
    });
    const resolved = normalized.map((key) => (
      skills.find((skill) => skill.key === key || normalizeSkillKey(skill.name) === key)
    ));
    const missing = values.filter((_, index) => !resolved[index]);
    if (missing.length) {
      throw new BadRequestException({
        message: 'Every selected quest skill must exist in the skill catalog.',
        unknownSkills: missing,
      });
    }
    const distinctIds = new Set(resolved.map((skill) => skill!.id));
    if (distinctIds.size !== resolved.length) {
      throw new BadRequestException('Select each skill only once.');
    }
    // Preserve the legacy QuestVersion.skills display-label contract. Skill
    // keys remain stable catalog identifiers and are resolved on the backend.
    return resolved.map((skill) => skill!.name);
  }

  private async lockSkillGraph(tx: Transaction): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "skills" ORDER BY "id" FOR UPDATE
    `;
  }

  private async assertSkillPrerequisites(
    tx: Transaction,
    skillId: string,
    prerequisiteIds: string[],
  ): Promise<void> {
    if (new Set(prerequisiteIds).size !== prerequisiteIds.length) {
      throw new BadRequestException('A prerequisite may be selected only once.');
    }
    if (prerequisiteIds.includes(skillId)) {
      throw new BadRequestException('A skill cannot depend on itself.');
    }
    if (prerequisiteIds.length === 0) return;

    const existing = await tx.skill.findMany({
      where: { id: { in: prerequisiteIds } },
      select: { id: true },
    });
    if (existing.length !== prerequisiteIds.length) {
      throw new BadRequestException('Every prerequisite must reference an existing skill.');
    }

    const edges = await tx.skillPrerequisite.findMany({
      select: { skillId: true, prerequisiteId: true },
    });
    const prerequisitesBySkill = new Map<string, string[]>();
    for (const edge of edges) {
      const list = prerequisitesBySkill.get(edge.skillId) ?? [];
      list.push(edge.prerequisiteId);
      prerequisitesBySkill.set(edge.skillId, list);
    }

    for (const prerequisiteId of prerequisiteIds) {
      const pending = [prerequisiteId];
      const visited = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (current === skillId) {
          throw new BadRequestException('Skill prerequisites cannot contain a cycle.');
        }
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(prerequisitesBySkill.get(current) ?? []));
      }
    }
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === code;
  }

  private async notifyQuestAuthor(
    tx: Transaction,
    notification: {
      authorId: string | null;
      questId: string;
      questVersionId: string;
      type: 'CHANGES_REQUESTED' | 'APPROVED' | 'PUBLISHED';
      message: string;
    },
  ): Promise<void> {
    if (!notification.authorId) return;
    await tx.questEditorialNotification.create({
      data: {
        recipientId: notification.authorId,
        questId: notification.questId,
        questVersionId: notification.questVersionId,
        type: notification.type,
        message: notification.message,
      },
    });
  }

  private async audit(
    tx: Transaction,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actorUserId,
        action,
        entityType,
        entityId,
        ...(before !== undefined ? { beforeJson: jsonInput(before) } : {}),
        ...(after !== undefined ? { afterJson: jsonInput(after) } : {}),
        ...(reason ? { reason } : {}),
      },
    });
  }
}
