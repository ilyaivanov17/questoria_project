import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SubmitAttemptDto } from './dto/submit-attempt.dto.js';
import type { StartRunDto } from './dto/start-run.dto.js';
import { asJsonRecord, asOptionList } from './json.js';

const LEVEL_REWARD = { xp: 5, coins: 2 };
const QUEST_REWARD = { xp: 25, coins: 10 };
const FINAL_PUZZLE_REWARD = { xp: 10, coins: 3 };

@Injectable()
export class QuestService {
  constructor(private readonly prisma: PrismaService) {}

  async getCategories(): Promise<object[]> {
    const categories = await this.prisma.category.findMany({
      where: { status: 'PUBLISHED', locale: 'ru' },
      orderBy: { sortOrder: 'asc' },
      include: {
        quests: {
          where: { status: 'PUBLISHED' },
          include: {
            versions: {
              where: { status: 'PUBLISHED' },
              orderBy: { versionNo: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    return categories.map((category) => ({
      slug: category.slug,
      title: category.title,
      description: category.description,
      quests: category.quests.flatMap((quest) => {
        const version = quest.versions[0];
        if (!version) return [];
        return [{
          slug: quest.slug,
          title: version.title,
          summary: version.summary,
          difficulty: version.difficulty,
          durationMin: version.durationMin,
          ageMin: version.ageMin,
          ageMax: version.ageMax,
        }];
      }),
    }));
  }

  async getPublicQuest(slug: string): Promise<object | null> {
    const quest = await this.prisma.quest.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        category: true,
        versions: {
          where: { status: 'PUBLISHED' },
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

    const version = quest?.versions[0];
    if (!quest || !version) return null;

    return {
      slug: quest.slug,
      category: {
        slug: quest.category.slug,
        title: quest.category.title,
      },
      title: version.title,
      summary: version.summary,
      objectives: version.objectives,
      ageMin: version.ageMin,
      ageMax: version.ageMax,
      difficulty: version.difficulty,
      durationMin: version.durationMin,
      seo: version.seo,
      levels: version.levels.map((level) => ({
        title: level.title,
        intro: level.intro,
        puzzles: level.puzzles.map((puzzle) => {
          const payload = asJsonRecord(puzzle.publicPayload);
          return {
            type: puzzle.type,
            prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
            options: asOptionList(payload.options),
            hints: puzzle.hints.map((hint) => hint.body),
          };
        }),
      })),
    };
  }

  async startRun(profileId: string, dto: StartRunDto): Promise<object> {
    const version = await this.prisma.questVersion.findFirst({
      where: {
        status: 'PUBLISHED',
        quest: { slug: dto.slug, status: 'PUBLISHED' },
      },
      orderBy: { versionNo: 'desc' },
    });

    if (!version) throw new NotFoundException('Quest not found.');

    const existing = await this.prisma.questRun.findFirst({
      where: {
        profileId,
        questVersionId: version.id,
        status: 'IN_PROGRESS',
      },
      orderBy: { startedAt: 'desc' },
    });

    const run = existing ?? await this.prisma.questRun.create({
      data: { profileId, questVersionId: version.id },
    });

    return this.getRun(profileId, run.id);
  }

  async getRun(profileId: string, runId: string): Promise<object> {
    const run = await this.prisma.questRun.findFirst({
      where: { id: runId, profileId },
      include: {
        questVersion: {
          include: {
            quest: { include: { category: true } },
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
        attempts: { orderBy: { createdAt: 'asc' } },
        levelProgress: true,
      },
    });

    if (!run) throw new NotFoundException('Quest run not found.');

    const puzzles = run.questVersion.levels.flatMap((level) =>
      level.puzzles.map((puzzle) => ({ level, puzzle })),
    );
    const completedPuzzleIds = new Set(
      run.attempts.filter((attempt) => attempt.isCorrect).map((attempt) => attempt.puzzleId),
    );

    const current = run.status === 'IN_PROGRESS'
      ? puzzles.find(({ puzzle }) => !completedPuzzleIds.has(puzzle.id))
      : undefined;

    const puzzleAttempts = current
      ? run.attempts.filter((attempt) => attempt.puzzleId === current.puzzle.id)
      : [];
    const currentPayload = current ? asJsonRecord(current.puzzle.publicPayload) : {};

    let result: object | null = null;
    if (run.status !== 'IN_PROGRESS') {
      const [completion, rewardEntries] = await Promise.all([
        this.prisma.questCompletion.findUnique({
          where: {
            profileId_questVersionId: {
              profileId,
              questVersionId: run.questVersionId,
            },
          },
        }),
        this.prisma.walletLedger.groupBy({
          by: ['currency'],
          where: { profileId, sourceId: run.id },
          _sum: { amount: true },
        }),
      ]);
      const balances = new Map(
        rewardEntries.map((entry) => [entry.currency, entry._sum.amount ?? 0]),
      );
      result = {
        success: run.status === 'COMPLETED',
        score: run.attempts.reduce((sum, attempt) => sum + attempt.score, 0),
        attempts: run.attempts.length,
        completedLevels: run.levelProgress.filter((progress) => progress.status === 'COMPLETED').length,
        completedAt: run.completedAt,
        rewards: {
          xp: balances.get('XP') ?? 0,
          coins: balances.get('COIN') ?? 0,
          firstCompletion: completion?.questRunId === run.id,
        },
      };
    }

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      quest: {
        slug: run.questVersion.quest.slug,
        title: run.questVersion.title,
        summary: run.questVersion.summary,
        category: run.questVersion.quest.category.title,
      },
      currentLevel: current ? {
        orderNo: current.level.orderNo,
        title: current.level.title,
        intro: current.level.intro,
      } : null,
      currentPuzzle: current ? {
        id: current.puzzle.id,
        type: current.puzzle.type,
        prompt: typeof currentPayload.prompt === 'string' ? currentPayload.prompt : '',
        options: asOptionList(currentPayload.options),
        hints: current.puzzle.hints.map((hint) => hint.body),
        attemptsMade: puzzleAttempts.length,
        attemptsRemaining: Math.max(0, current.puzzle.maxAttempts - puzzleAttempts.length),
        maxAttempts: current.puzzle.maxAttempts,
        maxScore: current.puzzle.maxScore,
        latestAttempt: puzzleAttempts.length ? {
          isCorrect: puzzleAttempts[puzzleAttempts.length - 1].isCorrect,
          feedback: puzzleAttempts[puzzleAttempts.length - 1].feedback,
          attemptsRemaining: puzzleAttempts[puzzleAttempts.length - 1].attemptsRemaining,
        } : null,
      } : null,
      result,
    };
  }

  async submitAttempt(
    profileId: string,
    runId: string,
    puzzleId: string,
    dto: SubmitAttemptDto,
  ): Promise<object> {
    const duplicate = await this.prisma.puzzleAttempt.findUnique({
      where: {
        profileId_attemptKey: {
          profileId,
          attemptKey: dto.attemptId,
        },
      },
    });
    if (duplicate) return this.validateAndReturnDuplicate(duplicate, runId, puzzleId, dto);

    const run = await this.prisma.questRun.findFirst({
      where: { id: runId, profileId },
    });
    if (!run) throw new NotFoundException('Quest run not found.');
    if (run.status !== 'IN_PROGRESS') {
      throw new ConflictException('This quest run is no longer active.');
    }

    const puzzle = await this.prisma.puzzle.findUnique({
      where: { id: puzzleId },
      include: { level: true },
    });
    if (!puzzle || puzzle.level.questVersionId !== run.questVersionId) {
      throw new NotFoundException('Puzzle not found in this quest run.');
    }
    if (puzzle.type !== 'single_choice') {
      throw new BadRequestException('This puzzle type is not supported in this MVP slice.');
    }

    const optionId = dto.answer.optionId;
    if (typeof optionId !== 'string') {
      throw new BadRequestException('answer.optionId must be a string.');
    }

    const payload = asJsonRecord(puzzle.publicPayload);
    const options = asOptionList(payload.options);
    if (!options.some((option) => option.id === optionId)) {
      throw new BadRequestException('Select one of the available options.');
    }

    const solution = asJsonRecord(puzzle.solutionPrivate);
    if (typeof solution.correctOptionId !== 'string') {
      throw new Error('Published puzzle has an invalid private solution configuration.');
    }

    const isCorrect = optionId === solution.correctOptionId;
    const feedback = isCorrect
      ? (typeof solution.correctFeedback === 'string'
        ? solution.correctFeedback
        : 'Верно!')
      : (typeof solution.incorrectFeedback === 'string'
        ? solution.incorrectFeedback
        : 'Пока не получилось. Попробуй ещё раз.');

    try {
      const attempt = await this.prisma.$transaction(async (tx) => {
        const activeRun = await tx.questRun.findFirst({
          where: { id: runId, profileId },
        });
        if (!activeRun) throw new NotFoundException('Quest run not found.');
        if (activeRun.status !== 'IN_PROGRESS') {
          throw new ConflictException('This quest run is no longer active.');
        }

        const orderedPuzzles = await tx.puzzle.findMany({
          where: { level: { questVersionId: activeRun.questVersionId } },
          orderBy: [{ level: { orderNo: 'asc' } }, { orderNo: 'asc' }],
          select: { id: true },
        });
        const solved = await tx.puzzleAttempt.findMany({
          where: { profileId, questRunId: runId, isCorrect: true },
          distinct: ['puzzleId'],
          select: { puzzleId: true },
        });
        const solvedIds = new Set(solved.map((item) => item.puzzleId));
        const expectedPuzzle = orderedPuzzles.find((item) => !solvedIds.has(item.id));
        if (!expectedPuzzle || expectedPuzzle.id !== puzzleId) {
          throw new ConflictException('Complete the current puzzle before moving to another one.');
        }

        const attemptsMade = await tx.puzzleAttempt.count({
          where: { profileId, questRunId: runId, puzzleId },
        });
        if (attemptsMade >= puzzle.maxAttempts) {
          throw new HttpException('No attempts remain for this puzzle.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const attemptsRemaining = Math.max(0, puzzle.maxAttempts - attemptsMade - 1);
        const saved = await tx.puzzleAttempt.create({
          data: {
            profileId,
            questRunId: runId,
            puzzleId,
            attemptKey: dto.attemptId,
            answer: dto.answer as Prisma.InputJsonValue,
            isCorrect,
            score: isCorrect ? puzzle.maxScore : 0,
            feedback,
            attemptsRemaining,
          },
        });

        let xpAwarded = 0;
        let coinsAwarded = 0;
        let runCompleted = false;
        let questFirstCompletion = false;

        if (isCorrect) {
          const levelPuzzleCount = await tx.puzzle.count({
            where: { levelId: puzzle.levelId },
          });
          const levelSolved = await tx.puzzleAttempt.findMany({
            where: {
              profileId,
              questRunId: runId,
              isCorrect: true,
              puzzle: { levelId: puzzle.levelId },
            },
            distinct: ['puzzleId'],
            select: { puzzleId: true },
          });

          if (levelPuzzleCount > 0 && levelSolved.length === levelPuzzleCount) {
            const levelAggregate = await tx.puzzleAttempt.aggregate({
              where: { profileId, questRunId: runId, puzzle: { levelId: puzzle.levelId } },
              _sum: { score: true },
            });
            await tx.levelProgress.createMany({
              data: [{
                id: randomUUID(),
                questRunId: runId,
                levelId: puzzle.levelId,
                status: 'COMPLETED',
                score: levelAggregate._sum.score ?? 0,
                completedAt: new Date(),
              }],
              skipDuplicates: true,
            });

            const levelXp = await tx.walletLedger.createMany({
              data: [{
                id: randomUUID(),
                profileId,
                currency: 'XP',
                amount: LEVEL_REWARD.xp,
                reason: 'Завершение уровня',
                sourceType: 'LEVEL_COMPLETION',
                sourceId: runId,
                idempotencyKey: `level_complete:${profileId}:${activeRun.questVersionId}:${puzzle.levelId}:XP`,
              }],
              skipDuplicates: true,
            });
            const levelCoins = await tx.walletLedger.createMany({
              data: [{
                id: randomUUID(),
                profileId,
                currency: 'COIN',
                amount: LEVEL_REWARD.coins,
                reason: 'Завершение уровня',
                sourceType: 'LEVEL_COMPLETION',
                sourceId: runId,
                idempotencyKey: `level_complete:${profileId}:${activeRun.questVersionId}:${puzzle.levelId}:COIN`,
              }],
              skipDuplicates: true,
            });
            xpAwarded += levelXp.count ? LEVEL_REWARD.xp : 0;
            coinsAwarded += levelCoins.count ? LEVEL_REWARD.coins : 0;
          }

          const allPuzzleIds = new Set(orderedPuzzles.map((item) => item.id));
          const solvedPuzzleIds = new Set(
            solved.map((item) => item.puzzleId).concat(puzzleId),
          );
          runCompleted = allPuzzleIds.size > 0 && [...allPuzzleIds].every((id) => solvedPuzzleIds.has(id));

          if (runCompleted) {
            const totalScore = await tx.puzzleAttempt.aggregate({
              where: { profileId, questRunId: runId },
              _sum: { score: true },
            });
            await tx.questRun.update({
              where: { id: runId },
              data: { status: 'COMPLETED', completedAt: new Date(), lastActivityAt: new Date() },
            });

            const completion = await tx.questCompletion.createMany({
              data: [{
                id: randomUUID(),
                profileId,
                questVersionId: activeRun.questVersionId,
                questRunId: runId,
                score: totalScore._sum.score ?? 0,
                xpAwarded: QUEST_REWARD.xp + FINAL_PUZZLE_REWARD.xp,
                coinsAwarded: QUEST_REWARD.coins + FINAL_PUZZLE_REWARD.coins,
                completedAt: new Date(),
              }],
              skipDuplicates: true,
            });
            questFirstCompletion = completion.count === 1;

            if (questFirstCompletion) {
              const questXp = await tx.walletLedger.createMany({
                data: [{
                  id: randomUUID(),
                  profileId,
                  currency: 'XP',
                  amount: QUEST_REWARD.xp,
                  reason: 'Первое завершение квеста',
                  sourceType: 'QUEST_COMPLETION',
                  sourceId: runId,
                  idempotencyKey: `quest_complete:${profileId}:${activeRun.questVersionId}:XP`,
                }],
                skipDuplicates: true,
              });
              const questCoins = await tx.walletLedger.createMany({
                data: [{
                  id: randomUUID(),
                  profileId,
                  currency: 'COIN',
                  amount: QUEST_REWARD.coins,
                  reason: 'Первое завершение квеста',
                  sourceType: 'QUEST_COMPLETION',
                  sourceId: runId,
                  idempotencyKey: `quest_complete:${profileId}:${activeRun.questVersionId}:COIN`,
                }],
                skipDuplicates: true,
              });
              const finalXp = await tx.walletLedger.createMany({
                data: [{
                  id: randomUUID(),
                  profileId,
                  currency: 'XP',
                  amount: FINAL_PUZZLE_REWARD.xp,
                  reason: 'Успешное итоговое задание',
                  sourceType: 'FINAL_PUZZLE',
                  sourceId: runId,
                  idempotencyKey: `final_puzzle:${profileId}:${activeRun.questVersionId}:XP`,
                }],
                skipDuplicates: true,
              });
              const finalCoins = await tx.walletLedger.createMany({
                data: [{
                  id: randomUUID(),
                  profileId,
                  currency: 'COIN',
                  amount: FINAL_PUZZLE_REWARD.coins,
                  reason: 'Успешное итоговое задание',
                  sourceType: 'FINAL_PUZZLE',
                  sourceId: runId,
                  idempotencyKey: `final_puzzle:${profileId}:${activeRun.questVersionId}:COIN`,
                }],
                skipDuplicates: true,
              });

              xpAwarded += (questXp.count ? QUEST_REWARD.xp : 0)
                + (finalXp.count ? FINAL_PUZZLE_REWARD.xp : 0);
              coinsAwarded += (questCoins.count ? QUEST_REWARD.coins : 0)
                + (finalCoins.count ? FINAL_PUZZLE_REWARD.coins : 0);
            }
          } else {
            await tx.questRun.update({
              where: { id: runId },
              data: { lastActivityAt: new Date() },
            });
          }
        } else {
          await tx.questRun.update({
            where: { id: runId },
            data: {
              status: attemptsRemaining === 0 ? 'ABANDONED' : 'IN_PROGRESS',
              completedAt: attemptsRemaining === 0 ? new Date() : null,
              lastActivityAt: new Date(),
            },
          });
        }

        return tx.puzzleAttempt.update({
          where: { id: saved.id },
          data: {
            xpAwarded,
            coinsAwarded,
            runCompleted,
            questFirstCompletion,
          },
        });
      }, { isolationLevel: 'Serializable' });

      return this.attemptResponse(attempt);
    } catch (error) {
      if (this.isPrismaCode(error, 'P2002')) {
        const retry = await this.prisma.puzzleAttempt.findUnique({
          where: {
            profileId_attemptKey: {
              profileId,
              attemptKey: dto.attemptId,
            },
          },
        });
        if (retry) return this.validateAndReturnDuplicate(retry, runId, puzzleId, dto);
      }
      if (this.isPrismaCode(error, 'P2034')) {
        throw new ConflictException('The attempt was processed concurrently. Retry with the same attemptId.');
      }
      throw error;
    }
  }

  private validateAndReturnDuplicate(
    attempt: {
      questRunId: string;
      puzzleId: string;
      answer: Prisma.JsonValue;
      attemptKey: string;
      isCorrect: boolean;
      score: number;
      feedback: string;
      attemptsRemaining: number;
      xpAwarded: number;
      coinsAwarded: number;
      runCompleted: boolean;
      questFirstCompletion: boolean;
    },
    runId: string,
    puzzleId: string,
    dto: SubmitAttemptDto,
  ): object {
    if (
      attempt.questRunId !== runId ||
      attempt.puzzleId !== puzzleId ||
      JSON.stringify(attempt.answer) !== JSON.stringify(dto.answer)
    ) {
      throw new ConflictException('This attemptId has already been used for another answer.');
    }
    return this.attemptResponse(attempt);
  }

  private attemptResponse(attempt: {
    attemptKey: string;
    isCorrect: boolean;
    score: number;
    feedback: string;
    attemptsRemaining: number;
    xpAwarded: number;
    coinsAwarded: number;
    runCompleted: boolean;
    questFirstCompletion: boolean;
  }): object {
    return {
      attemptId: attempt.attemptKey,
      result: attempt.isCorrect ? 'correct' : 'incorrect',
      scoreAwarded: attempt.score,
      attemptsRemaining: attempt.attemptsRemaining,
      feedback: attempt.feedback,
      rewards: {
        xp: attempt.xpAwarded,
        coins: attempt.coinsAwarded,
        firstCompletion: attempt.questFirstCompletion,
      },
      runCompleted: attempt.runCompleted,
      puzzleProgress: {
        completed: attempt.isCorrect,
        levelScore: attempt.score,
      },
    };
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}
