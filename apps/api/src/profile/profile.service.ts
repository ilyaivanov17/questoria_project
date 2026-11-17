import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(profileId: string): Promise<object> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { user: { select: { id: true, emailNormalized: true, createdAt: true } } },
    });
    if (!profile) throw new NotFoundException('Profile not found.');

    const [wallet, completedQuests, completedRuns, activeRuns] = await Promise.all([
      this.getBalances(profileId),
      this.prisma.questCompletion.count({ where: { profileId } }),
      this.prisma.questRun.count({ where: { profileId, status: 'COMPLETED' } }),
      this.prisma.questRun.count({ where: { profileId, status: 'IN_PROGRESS' } }),
    ]);

    return {
      id: profile.id,
      nickname: profile.nickname,
      ageBand: profile.ageBand,
      locale: profile.locale,
      createdAt: profile.createdAt,
      user: {
        id: profile.user.id,
        email: profile.user.emailNormalized,
        createdAt: profile.user.createdAt,
      },
      wallet,
      stats: { completedQuests, completedRuns, activeRuns },
    };
  }

  async updateProfile(profileId: string, dto: UpdateProfileDto): Promise<object> {
    const profile = await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        ...(dto.nickname !== undefined
          ? { nickname: dto.nickname === null ? null : dto.nickname.trim() || null }
          : {}),
      },
    });

    return {
      id: profile.id,
      nickname: profile.nickname,
      ageBand: profile.ageBand,
      locale: profile.locale,
      updatedAt: profile.updatedAt,
    };
  }

  async getProgress(profileId: string): Promise<object> {
    const [completedQuests, completedRuns, activeRuns, recentRuns, completedLevels] =
      await Promise.all([
        this.prisma.questCompletion.count({ where: { profileId } }),
        this.prisma.questRun.count({ where: { profileId, status: 'COMPLETED' } }),
        this.prisma.questRun.count({ where: { profileId, status: 'IN_PROGRESS' } }),
        this.prisma.questRun.findMany({
          where: { profileId },
          orderBy: { lastActivityAt: 'desc' },
          take: 10,
          include: {
            questVersion: {
              include: { quest: { select: { slug: true } } },
            },
            attempts: { select: { score: true } },
            levelProgress: {
              where: { status: 'COMPLETED' },
              select: { id: true },
            },
          },
        }),
        this.prisma.levelProgress.count({
          where: { status: 'COMPLETED', questRun: { profileId } },
        }),
      ]);

    return {
      stats: { completedQuests, completedRuns, activeRuns, completedLevels },
      recentRuns: recentRuns.map((run) => ({
        id: run.id,
        slug: run.questVersion.quest.slug,
        title: run.questVersion.title,
        status: run.status,
        score: run.attempts.reduce((sum, attempt) => sum + attempt.score, 0),
        completedLevels: run.levelProgress.length,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        lastActivityAt: run.lastActivityAt,
      })),
    };
  }

  async getWallet(profileId: string): Promise<object> {
    const [balances, entries] = await Promise.all([
      this.getBalances(profileId),
      this.prisma.walletLedger.findMany({
        where: { profileId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          currency: true,
          amount: true,
          reason: true,
          sourceType: true,
          createdAt: true,
        },
      }),
    ]);

    return { balances, entries };
  }

  private async getBalances(profileId: string): Promise<{ xp: number; coins: number }> {
    const rows = await this.prisma.walletLedger.groupBy({
      by: ['currency'],
      where: { profileId },
      _sum: { amount: true },
    });

    const balances = new Map(rows.map((row) => [row.currency, row._sum.amount ?? 0]));
    return {
      xp: balances.get('XP') ?? 0,
      coins: balances.get('COIN') ?? 0,
    };
  }
}
