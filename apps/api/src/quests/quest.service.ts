import { randomUUID } from 'node:crypto';
import {
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
import { buildPuzzleReview, validatePuzzleAnswer } from './puzzle-validator.js';
import type { PuzzleAnswerReview, PuzzleAttemptResponse, RunPuzzleReview } from '@questoria/contracts';
import {
  getNextAvailablePuzzle,
  getResolvedPuzzleIds,
  isPuzzleResolved,
} from './attempt-progress.js';

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
              include: {
                levels: { select: { id: true, _count: { select: { puzzles: true } } } },
              },
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
          coverUrl: version.coverUrl,
          coverAlt: version.coverAlt,
          skills: version.skills,
          levelCount: version.levels.length,
          puzzleCount: version.levels.reduce((sum, level) => sum + level._count.puzzles, 0),
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
      description: version.description,
      coverUrl: version.coverUrl,
      coverAlt: version.coverAlt,
      skills: version.skills,
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
            items: asOptionList(payload.items),
            placeholder: typeof payload.placeholder === 'string' ? payload.placeholder : null,
            unit: typeof payload.unit === 'string' ? payload.unit : null,
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

    const run = await this.prisma.$transaction(async (tx) => {
      // Serialize start requests for this player before checking whether a run
      // already exists. Otherwise concurrent retries can both observe no row
      // and create duplicate active runs for the same published quest version.
      const lockedProfile = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "profiles"
        WHERE "id" = ${profileId}::uuid
        FOR UPDATE
      `;
      if (lockedProfile.length !== 1) throw new NotFoundException('Profile not found.');

      const existing = await tx.questRun.findFirst({
        where: {
          profileId,
          questVersionId: version.id,
          status: 'IN_PROGRESS',
        },
        orderBy: { startedAt: 'desc' },
      });

      // Do not strand a player who already started this quest if the CMS later
      // adds prerequisites. Gate only creation of a new run.
      if (existing) return existing;

      await this.assertSkillPrerequisites(tx, profileId, version.skills);

      return tx.questRun.create({
        data: { profileId, questVersionId: version.id },
      });
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
    const resolvedPuzzleIds = getResolvedPuzzleIds(
      puzzles.map(({ puzzle }) => ({ id: puzzle.id, maxAttempts: puzzle.maxAttempts })),
      run.attempts,
    );

    // Older releases marked a run ABANDONED as soon as one puzzle exhausted
    // its attempts. Resume only when there is still an unresolved puzzle.
    // A legacy run whose every puzzle is already resolved must remain terminal;
    // reopening it would leave an IN_PROGRESS run with no current puzzle and
    // prevent the player from starting a fresh run.
    const hasUnresolvedPuzzles = resolvedPuzzleIds.size < puzzles.length;
    if (run.status === 'ABANDONED' && hasUnresolvedPuzzles) {
      const reopenedAt = new Date();
      const reopened = await this.prisma.questRun.updateMany({
        where: { id: run.id, profileId, status: 'ABANDONED' },
        data: { status: 'IN_PROGRESS', completedAt: null, lastActivityAt: reopenedAt },
      });
      if (reopened.count === 1) {
        run.status = 'IN_PROGRESS';
        run.completedAt = null;
        run.lastActivityAt = reopenedAt;
      } else {
        const currentState = await this.prisma.questRun.findUnique({
          where: { id: run.id },
          select: { status: true, completedAt: true, lastActivityAt: true },
        });
        if (currentState) {
          run.status = currentState.status;
          run.completedAt = currentState.completedAt;
          run.lastActivityAt = currentState.lastActivityAt;
        }
      }
    }

    const completedPuzzleIds = new Set(
      run.attempts.filter((attempt) => attempt.isCorrect).map((attempt) => attempt.puzzleId),
    );

    const current = run.status === 'IN_PROGRESS'
      ? getNextAvailablePuzzle(
        puzzles.map(({ level, puzzle }) => ({
          level,
          puzzle,
          id: puzzle.id,
          maxAttempts: puzzle.maxAttempts,
        })),
        run.attempts,
      )
      : undefined;

    const puzzleAttempts = current
      ? run.attempts.filter((attempt) => attempt.puzzleId === current.puzzle.id)
      : [];
    const currentPayload = current ? asJsonRecord(current.puzzle.publicPayload) : {};

    const latestExhaustedAttempt = [...run.attempts].reverse().find(
      (attempt) => !attempt.isCorrect && attempt.attemptsRemaining === 0,
    );
    const exhaustedPuzzle = latestExhaustedAttempt
      ? puzzles.find(({ puzzle }) => puzzle.id === latestExhaustedAttempt.puzzleId)?.puzzle
      : undefined;
    const lastReview: RunPuzzleReview | null = latestExhaustedAttempt && exhaustedPuzzle
      ? {
        puzzleId: exhaustedPuzzle.id,
        prompt: typeof asJsonRecord(exhaustedPuzzle.publicPayload).prompt === 'string'
          ? asJsonRecord(exhaustedPuzzle.publicPayload).prompt as string
          : '',
        ...buildPuzzleReview(
          exhaustedPuzzle.type,
          exhaustedPuzzle.publicPayload,
          exhaustedPuzzle.solutionPrivate,
        ),
      }
      : null;

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
      const everyPuzzleSolvedCorrectly = puzzles.length > 0
        && puzzles.every(({ puzzle }) => completedPuzzleIds.has(puzzle.id));
      result = {
        success: run.status === 'COMPLETED' && everyPuzzleSolvedCorrectly,
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
      progress: {
        completedPuzzles: resolvedPuzzleIds.size,
        correctPuzzles: completedPuzzleIds.size,
        totalPuzzles: puzzles.length,
        percent: puzzles.length ? Math.round((resolvedPuzzleIds.size / puzzles.length) * 100) : 0,
      },
      lastReview,
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
        items: asOptionList(currentPayload.items),
        placeholder: typeof currentPayload.placeholder === 'string' ? currentPayload.placeholder : null,
        unit: typeof currentPayload.unit === 'string' ? currentPayload.unit : null,
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
  ): Promise<PuzzleAttemptResponse> {
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
    const validation = validatePuzzleAnswer(
      puzzle.type,
      puzzle.publicPayload,
      puzzle.solutionPrivate,
      dto.answer,
    );
    const { isCorrect, feedback } = validation;

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
          select: { id: true, maxAttempts: true },
        });
        const priorAttempts = await tx.puzzleAttempt.findMany({
          where: { profileId, questRunId: runId },
          select: { puzzleId: true, isCorrect: true },
        });
        const expectedPuzzle = getNextAvailablePuzzle(orderedPuzzles, priorAttempts);
        if (!expectedPuzzle || expectedPuzzle.id !== puzzleId) {
          throw new ConflictException('Complete or review the current puzzle before moving to another one.');
        }

        const attemptsMade = priorAttempts.filter((attempt) => attempt.puzzleId === puzzleId).length;
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
        const attemptsAfterSave = [...priorAttempts, { puzzleId, isCorrect }];

        let xpAwarded = 0;
        let coinsAwarded = 0;
        let runCompleted = false;
        let questFirstCompletion = false;

        const levelPuzzles = await tx.puzzle.findMany({
          where: { levelId: puzzle.levelId },
          select: { id: true, maxAttempts: true },
        });
        const levelResolved = levelPuzzles.length > 0
          && levelPuzzles.every((levelPuzzle) => isPuzzleResolved(levelPuzzle, attemptsAfterSave));

        if (levelResolved) {
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

        runCompleted = orderedPuzzles.length > 0
          && orderedPuzzles.every((orderedPuzzle) => isPuzzleResolved(orderedPuzzle, attemptsAfterSave));
        const finalPuzzle = orderedPuzzles[orderedPuzzles.length - 1];
        const finalPuzzleCorrect = Boolean(
          finalPuzzle && attemptsAfterSave.some(
            (attempt) => attempt.puzzleId === finalPuzzle.id && attempt.isCorrect,
          ),
        );

        if (runCompleted) {
          const totalScore = await tx.puzzleAttempt.aggregate({
            where: { profileId, questRunId: runId },
            _sum: { score: true },
          });
          await tx.questRun.update({
            where: { id: runId },
            data: { status: 'COMPLETED', completedAt: new Date(), lastActivityAt: new Date() },
          });

          const completionXp = QUEST_REWARD.xp + (finalPuzzleCorrect ? FINAL_PUZZLE_REWARD.xp : 0);
          const completionCoins = QUEST_REWARD.coins + (finalPuzzleCorrect ? FINAL_PUZZLE_REWARD.coins : 0);
          const completion = await tx.questCompletion.createMany({
            data: [{
              id: randomUUID(),
              profileId,
              questVersionId: activeRun.questVersionId,
              questRunId: runId,
              score: totalScore._sum.score ?? 0,
              xpAwarded: completionXp,
              coinsAwarded: completionCoins,
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

            xpAwarded += questXp.count ? QUEST_REWARD.xp : 0;
            coinsAwarded += questCoins.count ? QUEST_REWARD.coins : 0;

            if (finalPuzzleCorrect) {
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
              xpAwarded += finalXp.count ? FINAL_PUZZLE_REWARD.xp : 0;
              coinsAwarded += finalCoins.count ? FINAL_PUZZLE_REWARD.coins : 0;
            }
          }
        } else {
          await tx.questRun.update({
            where: { id: runId },
            data: { lastActivityAt: new Date() },
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

      const review = !attempt.isCorrect && attempt.attemptsRemaining === 0
        ? buildPuzzleReview(puzzle.type, puzzle.publicPayload, puzzle.solutionPrivate)
        : undefined;
      return this.attemptResponse(attempt, review);
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

  private async assertSkillPrerequisites(
    tx: Prisma.TransactionClient,
    profileId: string,
    skillTags: string[],
  ): Promise<void> {
    const tags = [...new Set(skillTags.map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length === 0) return;

    // CMS graph mutations lock the same rows FOR UPDATE in this stable order.
    // Holding shared locks until the run is created closes the check/create race.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "skills"
      ORDER BY "id"
      FOR SHARE
    `;

    const skills = await tx.skill.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        prerequisites: { select: { prerequisiteId: true } },
        progress: {
          where: { profileId },
          select: { status: true },
          take: 1,
        },
      },
    });

    const normalize = (value: string) => value.trim().normalize('NFKC').toLowerCase();
    const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
    const skillsByAlias = new Map<string, Array<(typeof skills)[number]>>();

    for (const skill of skills) {
      for (const alias of [skill.key, skill.name]) {
        const normalizedAlias = normalize(alias);
        const matches = skillsByAlias.get(normalizedAlias) ?? [];
        matches.push(skill);
        skillsByAlias.set(normalizedAlias, matches);
      }
    }

    const targetSkillIds = new Set<string>();
    const missingSkills: string[] = [];
    const ambiguousSkills: string[] = [];

    for (const tag of tags) {
      const matches = [...new Map(
        (skillsByAlias.get(normalize(tag)) ?? []).map((skill) => [skill.id, skill]),
      ).values()];
      if (matches.length === 0) {
        missingSkills.push(tag);
      } else if (matches.length > 1) {
        ambiguousSkills.push(tag);
      } else {
        targetSkillIds.add(matches[0].id);
      }
    }

    if (missingSkills.length > 0 || ambiguousSkills.length > 0) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        code: 'SKILL_CATALOG_INCOMPLETE',
        message: 'Published quest skills must resolve to exactly one catalog entry.',
        missingSkills,
        ambiguousSkills,
      });
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const requiredPrerequisiteIds = new Set<string>();

    const collectPrerequisites = (skillId: string): void => {
      if (visiting.has(skillId)) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          code: 'SKILL_PREREQUISITE_GRAPH_INVALID',
          message: 'The skill prerequisite graph contains a cycle.',
        });
      }
      if (visited.has(skillId)) return;

      const skill = skillsById.get(skillId);
      if (!skill) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          code: 'SKILL_CATALOG_INCOMPLETE',
          message: 'A prerequisite references a missing skill.',
        });
      }

      visiting.add(skillId);
      for (const edge of skill.prerequisites) {
        requiredPrerequisiteIds.add(edge.prerequisiteId);
        collectPrerequisites(edge.prerequisiteId);
      }
      visiting.delete(skillId);
      visited.add(skillId);
    };

    for (const targetSkillId of targetSkillIds) {
      collectPrerequisites(targetSkillId);
    }

    const unmetPrerequisites = [...requiredPrerequisiteIds]
      .flatMap((id) => {
        const skill = skillsById.get(id);
        if (!skill || skill.progress[0]?.status === 'MASTERED') return [];
        return [{
          id: skill.id,
          key: skill.key,
          name: skill.name,
          status: skill.progress[0]?.status.toLowerCase() ?? 'not_started',
          mastered: false,
        }];
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));

    if (unmetPrerequisites.length > 0) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        code: 'SKILL_PREREQUISITES_NOT_MET',
        message: 'Master the required skills before starting this quest.',
        unmetPrerequisites,
      });
    }
  }

  private async validateAndReturnDuplicate(
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
  ): Promise<PuzzleAttemptResponse> {
    if (
      attempt.questRunId !== runId ||
      attempt.puzzleId !== puzzleId ||
      JSON.stringify(attempt.answer) !== JSON.stringify(dto.answer)
    ) {
      throw new ConflictException('This attemptId has already been used for another answer.');
    }

    let review: PuzzleAnswerReview | undefined;
    if (!attempt.isCorrect && attempt.attemptsRemaining === 0) {
      const puzzle = await this.prisma.puzzle.findUnique({
        where: { id: puzzleId },
        select: { type: true, publicPayload: true, solutionPrivate: true },
      });
      if (puzzle) review = buildPuzzleReview(puzzle.type, puzzle.publicPayload, puzzle.solutionPrivate);
    }
    return this.attemptResponse(attempt, review);
  }

  private attemptResponse(
    attempt: {
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
    review?: PuzzleAnswerReview,
  ): PuzzleAttemptResponse {
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
        completed: attempt.isCorrect || attempt.attemptsRemaining === 0,
        correct: attempt.isCorrect,
        levelScore: attempt.score,
      },
      ...(review ? { review } : {}),
    };
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}
