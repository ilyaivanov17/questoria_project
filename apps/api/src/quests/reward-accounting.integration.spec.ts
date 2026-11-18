import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QuestService } from './quest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface RunSnapshot {
  id: string;
  status: string;
  currentPuzzle: { id: string; type: string } | null;
  result: {
    success: boolean;
    rewards: { xp: number; coins: number; firstCompletion: boolean };
  } | null;
}

interface AttemptReceipt {
  result: string;
  runCompleted: boolean;
  rewards: { xp: number; coins: number; firstCompletion: boolean };
}

test(
  'PostgreSQL reward accounting: completion receipt reconciles to ledger and replay never mints rewards',
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
            // The wallet ledger is intentionally append-only. Keep this
            // synthetic profile as the permanent owner of its test entries.
            await tx.questCompletion.deleteMany({ where: { profileId } });
            await tx.puzzleAttempt.deleteMany({ where: { profileId } });
            await tx.levelProgress.deleteMany({
              where: { questRun: { profileId } },
            });
            await tx.questRun.deleteMany({ where: { profileId } });
          }

          if (questId) {
            // Published content is immutable; archival is the supported
            // lifecycle transition before fixture cleanup.
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
        emailNormalized: `reward-ledger-${fixtureId}@questoria.test`,
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
        slug: `reward-ledger-${fixtureId}`,
        locale: 'ru',
        title: 'Reward ledger integration',
        description: 'Temporary category for reward accounting tests.',
        status: 'PUBLISHED',
      },
    });
    categoryId = category.id;

    const quest = await prisma.quest.create({
      data: {
        categoryId,
        slug: `reward-ledger-${fixtureId}`,
        status: 'DRAFT',
        versions: {
          create: {
            versionNo: 1,
            title: 'Reward ledger integration quest',
            summary: 'A one-puzzle quest used to verify reward accounting.',
            objectives: ['Проверить сверку начислений'],
            ageMin: 14,
            ageMax: 99,
            difficulty: 'beginner',
            durationMin: 3,
            locale: 'ru',
            status: 'DRAFT',
            levels: {
              create: {
                orderNo: 1,
                title: 'Reward level',
                intro: 'Solve the puzzle to complete the quest.',
                puzzles: {
                  create: {
                    orderNo: 1,
                    type: 'single_choice',
                    maxAttempts: 3,
                    maxScore: 10,
                    publicPayload: {
                      prompt: 'Какой вариант верный?',
                      options: [
                        { id: 'correct', label: 'Верный ответ' },
                        { id: 'wrong', label: 'Неверный ответ' },
                      ],
                    },
                    solutionPrivate: {
                      correctOptionId: 'correct',
                      correctFeedback: 'Верно.',
                      incorrectFeedback: 'Попробуй ещё раз.',
                    },
                    hints: {
                      create: { orderNo: 1, body: 'Внимательно прочитай вопрос.' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      include: { versions: { select: { id: true } } },
    });
    questId = quest.id;
    const questVersionId = quest.versions[0]?.id;
    assert.ok(questVersionId, 'the integration fixture must create a quest version');

    await prisma.questVersion.update({
      where: { id: questVersionId },
      data: { status: 'PUBLISHED' },
    });
    await prisma.quest.update({
      where: { id: quest.id },
      data: { status: 'PUBLISHED' },
    });

    const service = new QuestService(prisma);
    const firstRun = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.equal(firstRun.status, 'IN_PROGRESS');
    assert.ok(firstRun.currentPuzzle);

    const attemptId = randomUUID();
    const firstReceipt = await service.submitAttempt(
      profileId,
      firstRun.id,
      firstRun.currentPuzzle.id,
      { attemptId, answer: { optionId: 'correct' } },
    ) as AttemptReceipt;

    assert.equal(firstReceipt.result, 'correct');
    assert.equal(firstReceipt.runCompleted, true);
    assert.deepEqual(firstReceipt.rewards, {
      xp: 40,
      coins: 15,
      firstCompletion: true,
    });

    const completedRun = await service.getRun(profileId, firstRun.id) as RunSnapshot;
    assert.equal(completedRun.status, 'COMPLETED');
    assert.equal(completedRun.result?.success, true);
    assert.deepEqual(completedRun.result?.rewards, {
      xp: 40,
      coins: 15,
      firstCompletion: true,
    });

    const completion = await prisma.questCompletion.findUnique({
      where: {
        profileId_questVersionId: { profileId, questVersionId },
      },
    });
    assert.ok(completion, 'the first run must create the unique quest completion');
    assert.equal(completion.questRunId, firstRun.id);
    assert.equal(completion.xpAwarded, 35, 'quest completion records base quest XP plus final-puzzle XP');
    assert.equal(completion.coinsAwarded, 13, 'quest completion records base quest coins plus final-puzzle coins');

    const ledgerEntries = await prisma.walletLedger.findMany({
      where: { profileId },
      select: {
        currency: true,
        amount: true,
        sourceType: true,
        sourceId: true,
        idempotencyKey: true,
      },
    });
    assert.equal(ledgerEntries.length, 6, 'first completion must create level, quest and final-puzzle entries for both currencies');
    assert.equal(
      new Set(ledgerEntries.map((entry) => entry.idempotencyKey)).size,
      ledgerEntries.length,
      'every ledger entry must have a unique idempotency key',
    );

    const sum = (entries: typeof ledgerEntries, currency: 'XP' | 'COIN') =>
      entries.filter((entry) => entry.currency === currency)
        .reduce((total, entry) => total + entry.amount, 0);
    assert.equal(sum(ledgerEntries, 'XP'), 40);
    assert.equal(sum(ledgerEntries, 'COIN'), 15);

    const completionEntries = ledgerEntries.filter(
      (entry) => entry.sourceId === firstRun.id
        && (entry.sourceType === 'QUEST_COMPLETION' || entry.sourceType === 'FINAL_PUZZLE'),
    );
    assert.equal(sum(completionEntries, 'XP'), completion.xpAwarded);
    assert.equal(sum(completionEntries, 'COIN'), completion.coinsAwarded);

    const levelEntries = ledgerEntries.filter(
      (entry) => entry.sourceId === firstRun.id && entry.sourceType === 'LEVEL_COMPLETION',
    );
    assert.equal(sum(levelEntries, 'XP'), 5);
    assert.equal(sum(levelEntries, 'COIN'), 2);

    const duplicateReceipt = await service.submitAttempt(
      profileId,
      firstRun.id,
      firstRun.currentPuzzle.id,
      { attemptId, answer: { optionId: 'correct' } },
    ) as AttemptReceipt;
    assert.deepEqual(duplicateReceipt, firstReceipt);
    assert.equal(
      await prisma.puzzleAttempt.count({ where: { profileId, questRunId: firstRun.id } }),
      1,
      'replaying an attemptId must not create another attempt row',
    );

    // A distinct run is allowed for practice, but the same version cannot
    // mint the level, quest or final-puzzle reward a second time.
    const replayRun = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.ok(replayRun.currentPuzzle);
    const replayReceipt = await service.submitAttempt(
      profileId,
      replayRun.id,
      replayRun.currentPuzzle.id,
      { attemptId: randomUUID(), answer: { optionId: 'correct' } },
    ) as AttemptReceipt;

    assert.equal(replayReceipt.runCompleted, true);
    assert.deepEqual(replayReceipt.rewards, {
      xp: 0,
      coins: 0,
      firstCompletion: false,
    });
    assert.equal(
      await prisma.questCompletion.count({ where: { profileId, questVersionId } }),
      1,
      'one profile can have only one first-completion receipt per published version',
    );
    assert.equal(
      await prisma.walletLedger.count({ where: { profileId } }),
      6,
      'replaying the same published version must not add ledger rows',
    );
  },
);
