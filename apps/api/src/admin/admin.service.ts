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
import { isSelfManagement, wouldRemoveLastActiveSuperAdmin } from './user-management.policy.js';

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
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.questVersion.findFirst({
        where: { questId: id, status: 'REVIEW' },
        orderBy: { versionNo: 'desc' },
      });
      if (!version) throw new ConflictException('A quest in REVIEW state was not found.');
      if (version.authorId && version.authorId === user.userId) {
        throw new ForbiddenException('Authors cannot approve their own content.');
      }
      const updated = await tx.questVersion.update({
        where: { id: version.id },
        data: {
          status: 'APPROVED',
          reviewerId: user.userId,
          approvedById: user.userId,
          approvedAt: new Date(),
        },
      });
      await this.audit(tx, user.userId, 'quest.approved', 'QUEST', id, {
        versionId: version.id, status: version.status,
      }, { versionId: updated.id, status: updated.status, reviewerId: user.userId });
      return { id, versionId: updated.id, versionNo: updated.versionNo, status: updated.status };
    });
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
