import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QuestService } from './quest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface RunSnapshot {
  id: string;
  status: string;
  currentPuzzle: { id: string; type: string } | null;
}

interface AttemptReceipt {
  result: string;
  runCompleted: boolean;
  rewards: { xp: number; coins: number; firstCompletion: boolean };
}

test(
  'PostgreSQL concurrent completion: only one run claims first reward and the other is safely retryable',
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const prisma = new PrismaService();
    await prisma.$connect();

    let profileId: string | undefined;
    let categoryId: string | undefined;
    let questId: string | undefined;

    t.after(async () => {
      try {
        await prisma.$transaction(async (tx) => {
          if (profileId) {
            // The wallet ledger is append-only; preserve its synthetic owner
            // and reward entries as the permanent accounting test record.
            await tx.questCompletion.deleteMany({ where: { profileId } });
            await tx.puzzleAttempt.deleteMany({ where: { profileId } });
            await tx.levelProgress.deleteMany({
              where: { questRun: { profileId } },
            });
            await tx.questRun.deleteMany({ where: { profileId } });
          }

          if (questId) {
            await tx.questVersion.updateMany({
              where: { questId, status: 'PUBLISHED' },
              data: { status: 'ARCHIVED' },
            });
            await tx.hint.deleteMany({
              where: { puzzle: { level: { questVersion: { questId } } } },
            });
            await tx.puzzle.deleteMany({
              where: { level: { questVersion: { questId } } },
            });
            await tx.level.deleteMany({ where: { questVersion: { questId } } });
            await tx.questVersion.deleteMany({ where: { questId } });
            await tx.quest.deleteMany({ where: { id: questId } });
          }

          if (categoryId) {
            await tx.category.deleteMany({ where: { id: categoryId } });
          }
        });
      } finally {
        await prisma.$disconnect();
      }
    });

    const fixtureId = randomUUID();
    const user = await prisma.user.create({
      data: {
        emailNormalized: `concurrent-completion-${fixtureId}@questoria.test`,
        passwordHash: 'integration-test-only-password-hash',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { locale: 'ru' } },
      },
      include: { profile: true },
    });
    assert.ok(user.profile, 'the integration fixture must create a profile');
    profileId = user.profile.id;

    const category = await prisma.category.create({
      data: {
        slug: `concurrent-completion-${fixtureId}`,
        locale: 'ru',
        title: 'Concurrent completion integration',
        description: 'Temporary category for concurrent completion tests.',
        status: 'PUBLISHED',
      },
    });
    categoryId = category.id;

    const quest = await prisma.quest.create({
      data: {
        categoryId,
        slug: `concurrent-completion-${fixtureId}`,
        status: 'DRAFT',
        versions: {
          create: {
            versionNo: 1,
            title: 'Concurrent completion quest',
            summary: 'A one-puzzle quest used to race two different runs.',
            objectives: ['Проверить конкурентное завершение'],
            ageMin: 14,
            ageMax: 99,
            difficulty: 'beginner',
            durationMin: 3,
            locale: 'ru',
            status: 'DRAFT',
            levels: {
              create: {
                orderNo: 1,
                title: 'Concurrent level',
                intro: 'Two runs will complete this puzzle at the same time.',
                puzzles: {
                  create: {
                    orderNo: 1,
                    type: 'single_choice',
                    maxAttempts: 3,
                    maxScore: 10,
                    publicPayload: {
                      prompt: 'Какой вариант правильный?',
                      options: [
                        { id: 'correct', label: 'Правильный ответ' },
                        { id: 'wrong', label: 'Другой ответ' },
                      ],
                    },
                    solutionPrivate: {
                      correctOptionId: 'correct',
                      correctFeedback: 'Верно.',
                      incorrectFeedback: 'Попробуй ещё раз.',
                    },
                    hints: {
                      create: { orderNo: 1, body: 'Сравни варианты.' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      include: {
        versions: {
          include: {
            levels: {
              include: { puzzles: { select: { id: true } } },
            },
          },
        },
      },
    });
    questId = quest.id;
    const questVersion = quest.versions[0];
    assert.ok(questVersion, 'the fixture must create a published version');
    const puzzleId = questVersion.levels[0]?.puzzles[0]?.id;
    assert.ok(puzzleId, 'the fixture must create a puzzle');

    await prisma.questVersion.update({
      where: { id: questVersion.id },
      data: { status: 'PUBLISHED' },
    });
    await prisma.quest.update({
      where: { id: quest.id },
      data: { status: 'PUBLISHED' },
    });

    // Create two distinct active runs for the same profile/version. This
    // models separate browser sessions that have already passed startRun.
    const [runA, runB] = await Promise.all([
      prisma.questRun.create({
        data: { profileId, questVersionId: questVersion.id },
      }),
      prisma.questRun.create({
        data: { profileId, questVersionId: questVersion.id },
      }),
    ]);

    const service = new QuestService(prisma);
    const submissions = [
      { runId: runA.id, attemptId: randomUUID() },
      { runId: runB.id, attemptId: randomUUID() },
    ];

    // The profile-row lock serializes same-player submissions before state
    // is read, so both requests should complete without a retryable 409.
    const concurrent = await Promise.allSettled(
      submissions.map(({ runId, attemptId }) =>
        service.submitAttempt(profileId!, runId, puzzleId, {
          attemptId,
          answer: { optionId: 'correct' },
        }),
      ),
    );

    const receipts: AttemptReceipt[] = concurrent.map((outcome, index) => {
      if (outcome.status === 'rejected') {
        throw new Error(
          `same-profile submission ${index + 1} should serialize instead of failing: ${String(outcome.reason)}`,
          { cause: outcome.reason },
        );
      }
      return outcome.value as AttemptReceipt;
    });

    assert.equal(receipts.length, 2);
    assert.ok(receipts.every((receipt) => receipt.result === 'correct'));
    assert.ok(receipts.every((receipt) => receipt.runCompleted));
    assert.equal(
      receipts.filter((receipt) => receipt.rewards.firstCompletion).length,
      1,
      'exactly one run may claim the first-completion reward',
    );
    assert.equal(
      receipts.filter((receipt) => receipt.rewards.xp === 40 && receipt.rewards.coins === 15).length,
      1,
      'exactly one receipt may contain the six first-completion ledger entries',
    );
    assert.equal(
      receipts.filter((receipt) => receipt.rewards.xp === 0 && receipt.rewards.coins === 0).length,
      1,
      'the competing run must complete without minting duplicate rewards',
    );

    const [runs, attempts, completions, ledger, levels] = await Promise.all([
      prisma.questRun.findMany({
        where: { id: { in: [runA.id, runB.id] } },
        select: { id: true, status: true },
      }),
      prisma.puzzleAttempt.findMany({
        where: { profileId, questRunId: { in: [runA.id, runB.id] } },
        select: { questRunId: true, attemptKey: true, runCompleted: true, questFirstCompletion: true, xpAwarded: true, coinsAwarded: true },
      }),
      prisma.questCompletion.findMany({
        where: { profileId, questVersionId: questVersion.id },
      }),
      prisma.walletLedger.findMany({
        where: { profileId },
        select: { currency: true, amount: true, sourceType: true, sourceId: true, idempotencyKey: true },
      }),
      prisma.levelProgress.findMany({
        where: { questRunId: { in: [runA.id, runB.id] } },
        select: { questRunId: true, levelId: true, status: true },
      }),
    ]);

    assert.equal(runs.length, 2);
    assert.ok(runs.every((run) => run.status === 'COMPLETED'));
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((attempt) => attempt.runCompleted));
    assert.equal(attempts.filter((attempt) => attempt.questFirstCompletion).length, 1);
    assert.equal(completions.length, 1, 'unique(profileId, questVersionId) must select exactly one winning run');

    const winningRunId = completions[0]!.questRunId;
    assert.ok([runA.id, runB.id].includes(winningRunId));
    assert.equal(
      attempts.find((attempt) => attempt.questRunId === winningRunId)?.questFirstCompletion,
      true,
      'the attempt receipt on the completion-owning run must claim first completion',
    );
    assert.equal(
      attempts.find((attempt) => attempt.questRunId !== winningRunId)?.questFirstCompletion,
      false,
      'the competing run must not claim first completion',
    );

    assert.equal(ledger.length, 6, 'one first completion creates exactly six currency/event ledger entries');
    assert.equal(new Set(ledger.map((entry) => entry.idempotencyKey)).size, 6);
    assert.ok(ledger.every((entry) => entry.sourceId === winningRunId));
    const sum = (currency: 'XP' | 'COIN') => ledger
      .filter((entry) => entry.currency === currency)
      .reduce((total, entry) => total + entry.amount, 0);
    assert.equal(sum('XP'), 40);
    assert.equal(sum('COIN'), 15);
    assert.equal(completions[0]!.xpAwarded, 35);
    assert.equal(completions[0]!.coinsAwarded, 13);

    assert.equal(levels.length, 2, 'both completed runs should retain independent level progress');
    assert.ok(levels.every((level) => level.status === 'COMPLETED'));
    assert.equal(new Set(levels.map((level) => level.questRunId)).size, 2);

    // A retry after the winner committed must return the persisted receipt
    // rather than re-entering the reward transaction.
    const winningSubmissionIndex = submissions.findIndex((item) => item.runId === winningRunId);
    assert.notEqual(winningSubmissionIndex, -1);
    const replayedWinner = await service.submitAttempt(
      profileId,
      winningRunId,
      puzzleId,
      {
        attemptId: submissions[winningSubmissionIndex]!.attemptId,
        answer: { optionId: 'correct' },
      },
    ) as AttemptReceipt;
    assert.deepEqual(replayedWinner, receipts[winningSubmissionIndex]);
  },
);
