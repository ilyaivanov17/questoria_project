import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../prisma/prisma.service.js';

test(
  'PostgreSQL achievements: unique milestones grant immutable one-time XP and serialize concurrent threshold events',
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const prisma = new PrismaService();
    await prisma.$connect();

    const profileIds: string[] = [];
    let categoryId: string | undefined;
    const questIds: string[] = [];

    t.after(async () => {
      try {
        await prisma.$transaction(async (tx) => {
          for (const profileId of profileIds) {
            // Wallet and achievement records are permanent. Keep their
            // synthetic profiles as immutable owners of the test ledger.
            await tx.questCompletion.deleteMany({ where: { profileId } });
            await tx.puzzleAttempt.deleteMany({ where: { profileId } });
            await tx.levelProgress.deleteMany({
              where: { questRun: { profileId } },
            });
            await tx.questRun.deleteMany({ where: { profileId } });
          }

          if (questIds.length) {
            await tx.questVersion.updateMany({
              where: { questId: { in: questIds }, status: 'PUBLISHED' },
              data: { status: 'ARCHIVED' },
            });
            await tx.hint.deleteMany({
              where: { puzzle: { level: { questVersion: { questId: { in: questIds } } } } },
            });
            await tx.puzzle.deleteMany({
              where: { level: { questVersion: { questId: { in: questIds } } } },
            });
            await tx.level.deleteMany({ where: { questVersion: { questId: { in: questIds } } } });
            await tx.questVersion.deleteMany({ where: { questId: { in: questIds } } });
            await tx.quest.deleteMany({ where: { id: { in: questIds } } });
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
        emailNormalized: `achievement-events-${fixtureId}@questoria.test`,
        passwordHash: 'integration-test-only-password-hash',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { locale: 'ru' } },
      },
      include: { profile: true },
    });
    assert.ok(user.profile);
    const profileId = user.profile.id;
    profileIds.push(profileId);

    const category = await prisma.category.create({
      data: {
        slug: `achievement-events-${fixtureId}`,
        locale: 'ru',
        title: 'Achievement integration',
        description: 'Temporary category for persistent achievement tests.',
        status: 'PUBLISHED',
      },
    });
    categoryId = category.id;

    const quests = await Promise.all([1, 2, 3].map((questNo) =>
      prisma.quest.create({
        data: {
          categoryId,
          slug: `achievement-events-${fixtureId}-${questNo}`,
          status: 'DRAFT',
          versions: {
            create: {
              versionNo: 1,
              title: `Achievement quest ${questNo}`,
              summary: 'Temporary quest for achievement milestones.',
              objectives: ['Проверить выдачу достижений'],
              ageMin: 14,
              ageMax: 99,
              difficulty: 'beginner',
              durationMin: 3,
              locale: 'ru',
              status: 'DRAFT',
            },
          },
        },
        include: { versions: { select: { id: true } } },
      }),
    ));
    questIds.push(...quests.map((quest) => quest.id));
    const versions = quests.map((quest) => quest.versions[0]);
    assert.ok(versions.every(Boolean), 'three independent quests must each have a version');

    const levels = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      prisma.level.create({
        data: {
          questVersionId: versions[0]!.id,
          orderNo: index + 1,
          title: `Achievement level ${index + 1}`,
          intro: 'A distinct level for the five-level milestone.',
        },
      }),
    ));

    const runs = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        prisma.questRun.create({
          data: { profileId, questVersionId: versions[0]!.id },
        }),
      ),
      prisma.questRun.create({
        data: { profileId, questVersionId: versions[1]!.id },
      }),
      prisma.questRun.create({
        data: { profileId, questVersionId: versions[2]!.id },
      }),
    ]);

    // Nine completed runs are not enough for the ten-run achievement.
    for (const run of runs.slice(0, 9)) {
      await prisma.questRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
    let awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.equal(awards.some((award) => award.achievement.code === 'ten-runs'), false);

    // The tenth completed run unlocks ten-runs and grants its XP in the same
    // database transaction as the status change.
    await prisma.questRun.update({
      where: { id: runs[9]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.ok(awards.some((award) => award.achievement.code === 'ten-runs'));

    for (const run of runs.slice(10)) {
      await prisma.questRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    // Four distinct levels plus a replay of the first level are still only
    // four unique level IDs; the fifth distinct level crosses the threshold.
    for (const level of levels.slice(0, 4)) {
      await prisma.levelProgress.create({
        data: { questRunId: runs[0]!.id, levelId: level.id, status: 'COMPLETED' },
      });
    }
    await prisma.levelProgress.create({
      data: { questRunId: runs[1]!.id, levelId: levels[0]!.id, status: 'COMPLETED' },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.equal(awards.some((award) => award.achievement.code === 'five-levels'), false);

    await prisma.levelProgress.create({
      data: { questRunId: runs[0]!.id, levelId: levels[4]!.id, status: 'COMPLETED' },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.ok(awards.some((award) => award.achievement.code === 'five-levels'));

    // Completion receipts are per published version, but "three-quests"
    // counts three different root quests rather than three versions of one quest.
    await prisma.questCompletion.create({
      data: {
        profileId,
        questVersionId: versions[0]!.id,
        questRunId: runs[0]!.id,
        score: 10,
      },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.ok(awards.some((award) => award.achievement.code === 'first-quest'));
    assert.equal(awards.some((award) => award.achievement.code === 'three-quests'), false);

    await prisma.questCompletion.create({
      data: {
        profileId,
        questVersionId: versions[1]!.id,
        questRunId: runs[10]!.id,
        score: 10,
      },
    });
    await prisma.questCompletion.create({
      data: {
        profileId,
        questVersionId: versions[2]!.id,
        questRunId: runs[11]!.id,
        score: 10,
      },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.equal(awards.filter((award) => (
      ['first-quest', 'three-quests', 'five-levels', 'ten-runs'].includes(award.achievement.code)
    )).length, 4);
    assert.ok(awards.some((award) => award.achievement.code === 'three-quests'));

    // Paid milestones above granted 70 XP. A normal 30 XP ledger event
    // crosses the 100 XP threshold and atomically unlocks hundred-xp.
    await prisma.walletLedger.create({
      data: {
        profileId,
        currency: 'XP',
        amount: 30,
        reason: 'Achievement integration threshold setup',
        sourceType: 'TEST',
        sourceId: runs[0]!.id,
        idempotencyKey: `achievement-test:${fixtureId}:xp-threshold`,
      },
    });
    awards = await prisma.profileAchievement.findMany({
      where: { profileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.equal(awards.length, 5);
    assert.ok(awards.some((award) => award.achievement.code === 'hundred-xp'));

    const ledger = await prisma.walletLedger.findMany({
      where: { profileId },
      select: { currency: true, amount: true, sourceType: true, idempotencyKey: true },
    });
    const achievementLedger = ledger.filter((entry) => entry.sourceType === 'ACHIEVEMENT');
    assert.equal(achievementLedger.length, 4);
    assert.equal(new Set(achievementLedger.map((entry) => entry.idempotencyKey)).size, 4);
    assert.equal(ledger.filter((entry) => entry.currency === 'XP')
      .reduce((sum, entry) => sum + entry.amount, 0), 110);
    assert.equal(ledger.filter((entry) => entry.currency === 'COIN')
      .reduce((sum, entry) => sum + entry.amount, 0), 0);
    assert.ok(awards.every((award) => award.coinsAwarded === 0));

    // A second player receives the 100 XP achievement from concurrent XP
    // events. Match the application write contract: serialize events on the
    // profile row before inserting a ledger event. The trigger reuses this lock
    // and the unique achievement receipt makes the award permanently one-time.
    const concurrentFixtureId = randomUUID();
    const concurrentUser = await prisma.user.create({
      data: {
        emailNormalized: `achievement-concurrent-${concurrentFixtureId}@questoria.test`,
        passwordHash: 'integration-test-only-password-hash',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { locale: 'ru' } },
      },
      include: { profile: true },
    });
    assert.ok(concurrentUser.profile);
    const concurrentProfileId = concurrentUser.profile.id;
    profileIds.push(concurrentProfileId);

    await prisma.walletLedger.create({
      data: {
        profileId: concurrentProfileId,
        currency: 'XP',
        amount: 99,
        reason: 'Concurrent achievement baseline',
        sourceType: 'TEST',
        sourceId: concurrentProfileId,
        idempotencyKey: `achievement-test:${concurrentProfileId}:baseline`,
      },
    });

    const createConcurrentXpEvent = (number: number) =>
      prisma.$transaction(async (tx) => {
        const lockedProfile = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "profiles"
          WHERE "id" = ${concurrentProfileId}::uuid
          FOR UPDATE
        `;
        assert.equal(lockedProfile.length, 1, 'the player profile must be locked before writing XP');

        return tx.walletLedger.create({
          data: {
            profileId: concurrentProfileId,
            currency: 'XP',
            amount: 1,
            reason: 'Concurrent achievement threshold event',
            sourceType: 'TEST',
            sourceId: concurrentProfileId,
            idempotencyKey: `achievement-test:${concurrentProfileId}:concurrent-${number}`,
          },
        });
      }, { isolationLevel: 'ReadCommitted' });

    await Promise.all([1, 2].map(createConcurrentXpEvent));

    const concurrentAward = await prisma.profileAchievement.findMany({
      where: { profileId: concurrentProfileId },
      include: { achievement: { select: { code: true } } },
    });
    assert.equal(
      concurrentAward.filter((award) => award.achievement.code === 'hundred-xp').length,
      1,
      'concurrent threshold events must create exactly one persistent achievement receipt',
    );
    const concurrentLedger = await prisma.walletLedger.findMany({
      where: { profileId: concurrentProfileId, currency: 'XP' },
      select: { amount: true, sourceType: true, idempotencyKey: true },
    });
    assert.equal(concurrentLedger.reduce((sum, entry) => sum + entry.amount, 0), 111);
    assert.equal(concurrentLedger.filter((entry) => entry.sourceType === 'ACHIEVEMENT').length, 1);
  },
);
