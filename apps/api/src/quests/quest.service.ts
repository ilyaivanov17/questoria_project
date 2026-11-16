import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  TooManyRequestsException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SubmitAttemptDto } from './dto/submit-attempt.dto.js';
import type { StartRunDto } from './dto/start-run.dto.js';
import { asJsonRecord, asOptionList } from './json.js';

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
        attempts: {
          orderBy: { createdAt: 'asc' },
        },
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
      result: run.status === 'IN_PROGRESS' ? null : {
        success: run.status === 'COMPLETED',
        score: run.attempts.reduce((sum, attempt) => sum + attempt.score, 0),
        attempts: run.attempts.length,
        completedAt: run.completedAt,
      },
    };
  }

  async submitAttempt(
    profileId: string,
    runId: string,
    puzzleId: string,
    dto: SubmitAttemptDto,
  ): Promise<object> {
    const existing = await this.prisma.puzzleAttempt.findUnique({
      where: {
        profileId_attemptKey: {
          profileId,
          attemptKey: dto.attemptId,
        },
      },
    });

    if (existing) {
      if (
        existing.questRunId !== runId ||
        existing.puzzleId !== puzzleId ||
        JSON.stringify(existing.answer) !== JSON.stringify(dto.answer)
      ) {
        throw new ConflictException('This attemptId has already been used for another answer.');
      }
      return this.attemptResponse(existing);
    }

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

    const attemptsMade = await this.prisma.puzzleAttempt.count({
      where: { profileId, questRunId: runId, puzzleId },
    });
    if (attemptsMade >= puzzle.maxAttempts) {
      throw new TooManyRequestsException('No attempts remain for this puzzle.');
    }

    const isCorrect = optionId === solution.correctOptionId;
    const attemptsRemaining = Math.max(0, puzzle.maxAttempts - attemptsMade - 1);
    const score = isCorrect ? puzzle.maxScore : 0;
    const feedback = isCorrect
      ? (typeof solution.correctFeedback === 'string'
        ? solution.correctFeedback
        : 'Верно!')
      : (typeof solution.incorrectFeedback === 'string'
        ? solution.incorrectFeedback
        : 'Пока не получилось. Попробуй ещё раз.');

    try {
      const attempt = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.puzzleAttempt.create({
          data: {
            profileId,
            questRunId: runId,
            puzzleId,
            attemptKey: dto.attemptId,
            answer: dto.answer as Prisma.InputJsonValue,
            isCorrect,
            score,
            feedback,
            attemptsRemaining,
          },
        });

        await tx.questRun.update({
          where: { id: runId },
          data: {
            status: isCorrect
              ? 'COMPLETED'
              : attemptsRemaining === 0 ? 'ABANDONED' : 'IN_PROGRESS',
            completedAt: isCorrect || attemptsRemaining === 0 ? new Date() : null,
            lastActivityAt: new Date(),
          },
        });

        return saved;
      });

      return this.attemptResponse(attempt);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.puzzleAttempt.findUnique({
          where: {
            profileId_attemptKey: {
              profileId,
              attemptKey: dto.attemptId,
            },
          },
        });
        if (duplicate) {
          if (
            duplicate.questRunId !== runId ||
            duplicate.puzzleId !== puzzleId ||
            JSON.stringify(duplicate.answer) !== JSON.stringify(dto.answer)
          ) {
            throw new ConflictException('This attemptId has already been used for another answer.');
          }
          return this.attemptResponse(duplicate);
        }
      }
      throw error;
    }
  }

  private attemptResponse(attempt: {
    id: string;
    isCorrect: boolean;
    score: number;
    feedback: string;
    attemptsRemaining: number;
  }): object {
    return {
      attemptId: attempt.id,
      result: attempt.isCorrect ? 'correct' : 'incorrect',
      scoreAwarded: attempt.score,
      attemptsRemaining: attempt.attemptsRemaining,
      feedback: attempt.feedback,
      puzzleProgress: {
        completed: attempt.isCorrect,
        levelScore: attempt.score,
      },
    };
  }
}
