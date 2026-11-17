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
import type { CreateQuestDto, LevelInputDto, PuzzleInputDto, UpdateQuestDto } from './dto/quest.dto.js';
import { validatePuzzleAnswer } from '../quests/puzzle-validator.js';

const EDITABLE_STATUSES = ['DRAFT'] as const;

type Transaction = Prisma.TransactionClient;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

  async listQuests(): Promise<object[]> {
    const quests = await this.prisma.quest.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { title: true, slug: true } },
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { id: true, versionNo: true, title: true, status: true, updatedAt: true },
        },
      },
    });
    return quests.map((quest) => ({
      id: quest.id,
      slug: quest.slug,
      status: quest.status,
      category: quest.category,
      latestVersion: quest.versions[0] ?? null,
    }));
  }

  async getQuest(id: string): Promise<object> {
    const quest = await this.prisma.quest.findUnique({
      where: { id },
      include: {
        category: true,
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
    return quest;
  }

  async createQuest(user: AuthenticatedUser, dto: CreateQuestDto): Promise<object> {
    this.validateQuestMetadata(dto);
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Choose an active published category.');

    return this.prisma.$transaction(async (tx) => {
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
          skills: dto.skills.map((skill) => skill.trim()),
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

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (!category) throw new BadRequestException('Choose an active published category.');
    }
    if (dto.ageMin !== undefined && dto.ageMax !== undefined && dto.ageMin > dto.ageMax) {
      throw new BadRequestException('Minimum age cannot exceed maximum age.');
    }

    return this.prisma.$transaction(async (tx) => {
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
          ...(dto.objectives !== undefined ? { objectives: jsonInput(dto.objectives) } : {}),
          ...(dto.skills !== undefined ? { skills: dto.skills.map((skill) => skill.trim()) } : {}),
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
          objectives: source.objectives,
          skills: source.skills,
          ageMin: source.ageMin,
          ageMax: source.ageMax,
          difficulty: source.difficulty,
          durationMin: source.durationMin,
          locale: source.locale,
          seo: source.seo ?? undefined,
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
    const version = await this.getLatestDraftVersion(id);
    const readiness = await this.checkPublishReadiness(version);
    if (readiness.errors.length) {
      throw new BadRequestException({ message: 'Quest is not ready for review.', errors: readiness.errors });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.questVersion.update({
        where: { id: version.id },
        data: { status: 'REVIEW', reviewerId: null, approvedAt: null, approvedById: null },
      });
      await this.audit(tx, user.userId, 'quest.submitted_for_review', 'QUEST', id, version, {
        versionId: updated.id, versionNo: updated.versionNo, status: updated.status,
      });
      return { id, versionId: updated.id, versionNo: updated.versionNo, status: updated.status };
    });
  }

  async approveQuest(user: AuthenticatedUser, id: string): Promise<object> {
    const version = await this.prisma.questVersion.findFirst({
      where: { questId: id, status: 'REVIEW' },
      orderBy: { versionNo: 'desc' },
    });
    if (!version) throw new ConflictException('A quest in REVIEW state was not found.');
    if (version.authorId && version.authorId === user.userId) {
      throw new ForbiddenException('Authors cannot approve their own content.');
    }
    const updated = await this.prisma.questVersion.update({
      where: { id: version.id },
      data: {
        status: 'APPROVED',
        reviewerId: user.userId,
        approvedById: user.userId,
        approvedAt: new Date(),
      },
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: user.userId,
        action: 'quest.approved',
        entityType: 'QUEST',
        entityId: id,
        beforeJson: jsonInput({ versionId: version.id, status: version.status }),
        afterJson: jsonInput({ versionId: updated.id, status: updated.status, reviewerId: user.userId }),
      },
    });
    return { id, versionId: updated.id, versionNo: updated.versionNo, status: updated.status };
  }

  async publishQuest(user: AuthenticatedUser, id: string): Promise<object> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId: id, status: 'APPROVED' },
        orderBy: { versionNo: 'desc' },
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

      const updatedVersion = await tx.questVersion.update({
        where: { id: version.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: user.userId,
        },
      });
      await tx.quest.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await this.audit(tx, user.userId, 'quest.published', 'QUEST', id, {
        versionId: version.id, status: version.status,
      }, {
        versionId: updatedVersion.id, versionNo: updatedVersion.versionNo, status: updatedVersion.status,
      });
      return { id, versionId: updatedVersion.id, versionNo: updatedVersion.versionNo, status: updatedVersion.status };
    });
  }

  async listAuditLogs(take = 50): Promise<object[]> {
    const safeTake = Math.min(Math.max(take, 1), 100);
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: safeTake,
      include: { actor: { select: { emailNormalized: true } } },
    });
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

  private async getLatestDraftVersion(questId: string) {
    const version = await this.prisma.questVersion.findFirst({
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

  private async checkPublishReadiness(version: Awaited<ReturnType<AdminService['getLatestDraftVersion']>>) {
    const errors: string[] = [];
    if (!version.title.trim()) errors.push('Title is required.');
    if (version.summary.trim().length < 20) errors.push('Summary must contain at least 20 characters.');
    if (version.description.trim().length < 50) errors.push('Description must contain at least 50 characters.');
    if (!Array.isArray(version.objectives) || version.objectives.length < 2 || version.objectives.length > 4) {
      errors.push('Provide 2–4 learning objectives.');
    }
    if (version.skills.length < 1) errors.push('Select at least one skill.');
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
