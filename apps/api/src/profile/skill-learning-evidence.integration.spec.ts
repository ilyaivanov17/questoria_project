import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../prisma/prisma.service.js';

test(
  'PostgreSQL skill evidence: only successful, varied and delayed/transfer evidence can establish mastery',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const prisma = new PrismaService();
    await prisma.$connect();

    // Learning evidence is append-only and references immutable published
    // content. These synthetic fixtures intentionally remain in the ephemeral
    // CI database rather than deleting or rewriting their learning history.
    const fixtureId = randomUUID();
    const user = await prisma.user.create({
      data: {
        emailNormalized: `skill-evidence-${fixtureId}@questoria.test`,
        passwordHash: 'integration-test-only-password-hash',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { locale: 'ru' } },
      },
      include: { profile: true },
    });
    assert.ok(user.profile);
    const profileId = user.profile.id;

    const category = await prisma.category.create({
      data: {
        slug: `skill-evidence-${fixtureId}`,
        locale: 'ru',
        title: 'Skill evidence integration',
        description: 'Temporary category used by the skill evidence integration test.',
        status: 'PUBLISHED',
      },
    });

    const questDefinitions = [
      {
        slug: `memory-evidence-${fixtureId}`,
        title: 'Delayed recall mission',
        skillTags: ['memory-recall'],
        puzzleTypes: ['single_choice', 'numeric_input', 'ordering'],
      },
      {
        slug: `transfer-source-${fixtureId}`,
        title: 'Critical thinking source mission',
        skillTags: ['critical-thinking'],
        puzzleTypes: ['single_choice', 'numeric_input', 'ordering'],
      },
      {
        slug: `transfer-target-${fixtureId}`,
        title: 'Critical thinking transfer mission',
        skillTags: ['critical-thinking'],
        puzzleTypes: ['multiple_choice', 'text_input'],
      },
    ] as const;

    const fixtures = await Promise.all(questDefinitions.map(async (definition, questIndex) => {
      const quest = await prisma.quest.create({
        data: {
          categoryId: category.id,
          slug: definition.slug,
          status: 'DRAFT',
          versions: {
            create: {
              versionNo: 1,
              title: definition.title,
              summary: 'A small mission for validating skill learning evidence.',
              objectives: ['Проверить освоение навыка'],
              ageMin: 14,
              ageMax: 99,
              difficulty: 'beginner',
              durationMin: 5,
              locale: 'ru',
              skills: [...definition.skillTags],
              status: 'DRAFT',
            },
          },
        },
        include: { versions: true },
      });
      const version = quest.versions[0];
      assert.ok(version);

      const level = await prisma.level.create({
        data: {
          questVersionId: version.id,
          orderNo: 1,
          title: `Level ${questIndex + 1}`,
          intro: 'Use different task formats to demonstrate the skill.',
        },
      });

      const puzzles = await Promise.all(definition.puzzleTypes.map((type, index) =>
        prisma.puzzle.create({
          data: {
            levelId: level.id,
            orderNo: index + 1,
            type,
            publicPayload: { prompt: 'Integration test puzzle' },
            solutionPrivate: { acceptedAnswers: ['answer'] },
            maxAttempts: 3,
            maxScore: 10,
          },
        }),
      ));

      await prisma.questVersion.update({
        where: { id: version.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      await prisma.quest.update({
        where: { id: quest.id },
        data: { status: 'PUBLISHED' },
      });

      const run = await prisma.questRun.create({
        data: { profileId, questVersionId: version.id },
      });

      return { quest, version, puzzles, run };
    }));

    const addAttempt = async (
      runId: string,
      puzzleId: string,
      isCorrect: boolean,
      createdAt?: Date,
    ) => prisma.puzzleAttempt.create({
      data: {
        profileId,
        questRunId: runId,
        puzzleId,
        attemptKey: randomUUID(),
        answer: { integration: true },
        isCorrect,
        score: isCorrect ? 10 : 0,
        feedback: isCorrect ? 'Correct.' : 'Try again.',
        attemptsRemaining: 2,
        ...(createdAt ? { createdAt } : {}),
      },
    });

    const memory = fixtures[0]!;
    const criticalSource = fixtures[1]!;
    const criticalTransfer = fixtures[2]!;

    // A successful baseline from 48 hours ago is an initial learning signal.
    const oldSuccess = await addAttempt(
      memory.run.id,
      memory.puzzles[0]!.id,
      true,
      new Date(Date.now() - 48 * 60 * 60 * 1000),
    );

    let memoryProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'memory-recall' } },
    });
    assert.equal(memoryProgress?.status, 'PRACTICING');
    assert.equal(memoryProgress?.successfulAttempts, 1);

    // The next correct answer on the same skill is a delayed check because
    // the last successful evidence is more than 24 hours old.
    const delayedCheck = await addAttempt(
      memory.run.id,
      memory.puzzles[1]!.id,
      true,
    );
    let evidence = await prisma.learningEvidence.findMany({
      where: { profileId, puzzleAttemptId: { in: [oldSuccess.id, delayedCheck.id] } },
      include: { skill: { select: { key: true } } },
      orderBy: { occurredAt: 'asc' },
    });
    assert.equal(evidence.find((item) => item.puzzleAttemptId === oldSuccess.id)?.evidenceType, 'INITIAL');
    assert.equal(evidence.find((item) => item.puzzleAttemptId === delayedCheck.id)?.evidenceType, 'DELAYED_CHECK');

    await addAttempt(memory.run.id, memory.puzzles[2]!.id, true);
    await addAttempt(memory.run.id, memory.puzzles[0]!.id, true);
    memoryProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'memory-recall' } },
    });
    assert.equal(memoryProgress?.status, 'PROFICIENT');
    assert.equal(memoryProgress?.distinctPuzzles, 3);
    assert.equal(memoryProgress?.distinctTaskTypes, 3);
    assert.equal(memoryProgress?.distinctQuests, 1);

    await addAttempt(memory.run.id, memory.puzzles[1]!.id, true);
    memoryProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'memory-recall' } },
    });
    assert.equal(memoryProgress?.status, 'MASTERED');
    assert.equal(memoryProgress?.successfulAttempts, 5);
    assert.ok(memoryProgress?.masteredAt);

    // Four correct answers across three puzzles and three task types produce
    // PROFICIENT, but a second published version of the same root quest would
    // not count as an independent transfer. The target below is a separate quest.
    await addAttempt(criticalSource.run.id, criticalSource.puzzles[0]!.id, true);
    await addAttempt(criticalSource.run.id, criticalSource.puzzles[1]!.id, true);
    await addAttempt(criticalSource.run.id, criticalSource.puzzles[2]!.id, true);
    await addAttempt(criticalSource.run.id, criticalSource.puzzles[0]!.id, true);

    let criticalProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'critical-thinking' } },
    });
    assert.equal(criticalProgress?.status, 'PROFICIENT');
    assert.equal(criticalProgress?.successfulAttempts, 4);
    assert.equal(criticalProgress?.distinctQuests, 1);

    // A wrong answer in another quest is evidence of practice, but must not
    // count toward successful quest transfer or mastery diversity.
    const failedTransfer = await addAttempt(
      criticalTransfer.run.id,
      criticalTransfer.puzzles[1]!.id,
      false,
    );
    criticalProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'critical-thinking' } },
    });
    assert.equal(criticalProgress?.status, 'PROFICIENT');
    assert.equal(criticalProgress?.successfulAttempts, 4);
    assert.equal(criticalProgress?.distinctPuzzles, 3);
    assert.equal(criticalProgress?.distinctQuests, 1);

    // Two independent requests race on the same profile. The trigger's
    // profile-row lock must serialize their aggregate updates without loss.
    const concurrentAttempts = await Promise.all([
      addAttempt(
        criticalTransfer.run.id,
        criticalTransfer.puzzles[0]!.id,
        true,
      ),
      addAttempt(
        criticalTransfer.run.id,
        criticalTransfer.puzzles[1]!.id,
        true,
      ),
    ]);
    criticalProgress = await prisma.profileSkillProgress.findFirst({
      where: { profileId, skill: { key: 'critical-thinking' } },
    });
    assert.equal(criticalProgress?.status, 'MASTERED');
    assert.equal(criticalProgress?.attemptsCount, 7);
    assert.equal(criticalProgress?.successfulAttempts, 6);
    assert.equal(criticalProgress?.distinctPuzzles, 5);
    assert.equal(criticalProgress?.distinctTaskTypes, 5);
    assert.equal(criticalProgress?.distinctQuests, 2);
    assert.ok(criticalProgress?.masteredAt);

    evidence = await prisma.learningEvidence.findMany({
      where: {
        profileId,
        puzzleAttemptId: { in: [failedTransfer.id, ...concurrentAttempts.map((attempt) => attempt.id)] },
      },
      include: { skill: { select: { key: true } } },
    });
    assert.ok(evidence.every((item) => item.evidenceType === 'TRANSFER'));
    assert.equal(evidence.find((item) => item.puzzleAttemptId === failedTransfer.id)?.isCorrect, false);
    assert.ok(evidence.filter((item) => item.isCorrect).length === 2);

    const allEvidence = await prisma.learningEvidence.findMany({
      where: { profileId },
      include: { skill: { select: { key: true } } },
    });
    assert.equal(allEvidence.filter((item) => item.skill.key === 'memory-recall').length, 5);
    assert.equal(allEvidence.filter((item) => item.skill.key === 'critical-thinking').length, 7);
    assert.equal(
      new Set(allEvidence.map((item) => `${item.puzzleAttemptId}:${item.skillId}`)).size,
      allEvidence.length,
      'one attempt can generate at most one evidence item per tagged skill',
    );

    const memoryKey = await prisma.skill.findUnique({ where: { key: 'memory-recall' } });
    assert.ok(memoryKey);
    const memoryProgressFinal = await prisma.profileSkillProgress.findUnique({
      where: { profileId_skillId: { profileId, skillId: memoryKey.id } },
    });
    assert.equal(memoryProgressFinal?.status, 'MASTERED');
    assert.equal(memoryProgressFinal?.successfulAttempts, 5);

    await prisma.$disconnect();
  },
);
