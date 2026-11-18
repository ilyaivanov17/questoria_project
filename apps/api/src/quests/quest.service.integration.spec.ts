import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QuestService } from './quest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface RunSnapshot {
  id: string;
  status: string;
  currentPuzzle: { id: string; type: string } | null;
  lastReview: {
    puzzleId: string;
    prompt: string;
    explanation: string;
    correctAnswer: Record<string, unknown>;
    correctAnswerText: string;
  } | null;
  result: {
    success: boolean;
    rewards: { xp: number; coins: number; firstCompletion: boolean };
  } | null;
}

test(
  'PostgreSQL gameplay integration: exhausted attempts review, resume and never farm rewards',
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
            // wallet_ledger is intentionally append-only and references profiles.
            // Keep this unique synthetic user/profile as the immutable ledger owner.
            await tx.questCompletion.deleteMany({ where: { profileId } });
            await tx.puzzleAttempt.deleteMany({ where: { profileId } });
            await tx.levelProgress.deleteMany({
              where: { questRun: { profileId } },
            });
            await tx.questRun.deleteMany({ where: { profileId } });
          }

          if (questId) {
            // Published versions are immutable; archival is the allowed
            // lifecycle transition before deleting this temporary fixture.
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
        emailNormalized: `quest-run-${fixtureId}@questoria.test`,
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
        slug: `integration-${fixtureId}`,
        locale: 'ru',
        title: 'Integration test',
        description: 'Temporary category for gameplay integration testing.',
        status: 'PUBLISHED',
      },
    });
    categoryId = category.id;

    const quest = await prisma.quest.create({
      data: {
        categoryId,
        slug: `integration-${fixtureId}`,
        status: 'DRAFT',
        versions: {
          create: {
            versionNo: 1,
            title: 'Attempt review integration quest',
            summary: 'A temporary quest used by the API integration test.',
            objectives: ['Проверить обзор ответа', 'Продолжить прохождение'],
            ageMin: 14,
            ageMax: 99,
            difficulty: 'beginner',
            durationMin: 5,
            locale: 'ru',
            status: 'DRAFT',
            levels: {
              create: {
                orderNo: 1,
                title: 'Integration level',
                intro: 'Complete or review each puzzle.',
                puzzles: {
                  create: [
                    {
                      orderNo: 1,
                      type: 'single_choice',
                      maxAttempts: 1,
                      maxScore: 10,
                      publicPayload: {
                        prompt: 'Первое задание',
                        options: [
                          { id: 'first-correct', label: 'Верный вариант' },
                          { id: 'first-wrong', label: 'Неверный вариант' },
                        ],
                      },
                      solutionPrivate: {
                        correctOptionId: 'first-correct',
                        correctFeedback: 'Первое объяснение.',
                        incorrectFeedback: 'Попробуй ещё раз.',
                      },
                      hints: {
                        create: { orderNo: 1, body: 'Посмотри внимательно.' },
                      },
                    },
                    {
                      orderNo: 2,
                      type: 'single_choice',
                      maxAttempts: 1,
                      maxScore: 10,
                      publicPayload: {
                        prompt: 'Итоговое задание',
                        options: [
                          { id: 'final-correct', label: 'Верный вариант' },
                          { id: 'final-wrong', label: 'Неверный вариант' },
                        ],
                      },
                      solutionPrivate: {
                        correctOptionId: 'final-correct',
                        correctFeedback: 'Итоговое объяснение.',
                        incorrectFeedback: 'Это не тот вариант.',
                      },
                      hints: {
                        create: { orderNo: 1, body: 'Сравни варианты.' },
                      },
                    },
                  ],
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
    const started = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.equal(started.status, 'IN_PROGRESS');
    assert.ok(started.currentPuzzle);
    const firstPuzzleId = started.currentPuzzle.id;

    const firstAttemptId = randomUUID();
    const firstAttempt = await service.submitAttempt(
      profileId,
      started.id,
      firstPuzzleId,
      { attemptId: firstAttemptId, answer: { optionId: 'first-wrong' } },
    );
    assert.equal(firstAttempt.result, 'incorrect');
    assert.equal(firstAttempt.attemptsRemaining, 0);
    assert.equal(firstAttempt.puzzleProgress.completed, true);
    assert.equal(firstAttempt.puzzleProgress.correct, false);
    assert.equal(firstAttempt.runCompleted, false);
    assert.deepEqual(firstAttempt.review, {
      explanation: 'Первое объяснение.',
      correctAnswer: { optionId: 'first-correct' },
      correctAnswerText: 'Верный вариант',
    });

    // Simulate an unfinished run written by the previous implementation.
    await prisma.questRun.update({
      where: { id: started.id },
      data: { status: 'ABANDONED', completedAt: new Date() },
    });

    const resumed = await service.getRun(profileId, started.id) as RunSnapshot;
    assert.equal(resumed.status, 'IN_PROGRESS');
    assert.ok(resumed.currentPuzzle);
    assert.notEqual(resumed.currentPuzzle.id, firstPuzzleId);
    assert.equal(resumed.lastReview?.puzzleId, firstPuzzleId);
    assert.deepEqual(resumed.lastReview?.correctAnswer, { optionId: 'first-correct' });
    assert.equal(resumed.lastReview?.correctAnswerText, 'Верный вариант');

    const finalAttemptId = randomUUID();
    const finalAttempt = await service.submitAttempt(
      profileId,
      started.id,
      resumed.currentPuzzle.id,
      { attemptId: finalAttemptId, answer: { optionId: 'final-wrong' } },
    );
    assert.equal(finalAttempt.result, 'incorrect');
    assert.equal(finalAttempt.runCompleted, true);
    assert.deepEqual(finalAttempt.review, {
      explanation: 'Итоговое объяснение.',
      correctAnswer: { optionId: 'final-correct' },
      correctAnswerText: 'Верный вариант',
    });
    assert.deepEqual(finalAttempt.rewards, {
      xp: 30,
      coins: 12,
      firstCompletion: true,
    });

    const result = await service.getRun(profileId, started.id) as RunSnapshot;
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.result?.success, false);
    assert.deepEqual(result.result?.rewards, {
      xp: 30,
      coins: 12,
      firstCompletion: true,
    });

    // Idempotent replay must return the saved review/reward response.
    const duplicate = await service.submitAttempt(
      profileId,
      started.id,
      resumed.currentPuzzle.id,
      { attemptId: finalAttemptId, answer: { optionId: 'final-wrong' } },
    );
    assert.deepEqual(duplicate, finalAttempt);

    const firstRunLedgerCount = await prisma.walletLedger.count({ where: { profileId } });
    assert.equal(firstRunLedgerCount, 4, 'one level and one quest completion produce four ledger entries');

    // A second run may be played for practice, but the same quest version and
    // level must not mint another first-completion or level reward.
    const replayRun = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.ok(replayRun.currentPuzzle);
    const replayFirst = await service.submitAttempt(
      profileId,
      replayRun.id,
      replayRun.currentPuzzle.id,
      { attemptId: randomUUID(), answer: { optionId: 'first-wrong' } },
    );
    assert.equal(replayFirst.runCompleted, false);

    const replayState = await service.getRun(profileId, replayRun.id) as RunSnapshot;
    assert.ok(replayState.currentPuzzle);
    const replayFinal = await service.submitAttempt(
      profileId,
      replayRun.id,
      replayState.currentPuzzle.id,
      { attemptId: randomUUID(), answer: { optionId: 'final-wrong' } },
    );
    assert.equal(replayFinal.runCompleted, true);
    assert.deepEqual(replayFinal.rewards, {
      xp: 0,
      coins: 0,
      firstCompletion: false,
    });
    assert.equal(
      await prisma.walletLedger.count({ where: { profileId } }),
      firstRunLedgerCount,
      'replaying the same published quest version must not create ledger entries',
    );

    // A legacy run abandoned after its final exhausted puzzle is terminal. It
    // must not be reopened as an empty IN_PROGRESS run that blocks a new start.
    const legacyExhaustedRun = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.ok(legacyExhaustedRun.currentPuzzle);
    const legacyFirst = await service.submitAttempt(
      profileId,
      legacyExhaustedRun.id,
      legacyExhaustedRun.currentPuzzle.id,
      { attemptId: randomUUID(), answer: { optionId: 'first-wrong' } },
    );
    assert.equal(legacyFirst.runCompleted, false);
    const legacyProgress = await service.getRun(profileId, legacyExhaustedRun.id) as RunSnapshot;
    assert.ok(legacyProgress.currentPuzzle);
    const legacyFinal = await service.submitAttempt(
      profileId,
      legacyExhaustedRun.id,
      legacyProgress.currentPuzzle.id,
      { attemptId: randomUUID(), answer: { optionId: 'final-wrong' } },
    );
    assert.equal(legacyFinal.runCompleted, true);

    // Model the ABANDONED status written by the previous release for this
    // all-exhausted run.
    await prisma.questRun.update({
      where: { id: legacyExhaustedRun.id },
      data: { status: 'ABANDONED', completedAt: new Date() },
    });
    const terminalLegacyRun = await service.getRun(profileId, legacyExhaustedRun.id) as RunSnapshot;
    assert.equal(terminalLegacyRun.status, 'ABANDONED');
    assert.equal(terminalLegacyRun.currentPuzzle, null);
    assert.equal(terminalLegacyRun.result?.success, false);

    const freshRun = await service.startRun(profileId, { slug: quest.slug }) as RunSnapshot;
    assert.notEqual(freshRun.id, legacyExhaustedRun.id);
    assert.equal(freshRun.status, 'IN_PROGRESS');
    assert.ok(freshRun.currentPuzzle);
  },
);
