import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from './profile.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-18T10:00:00.000Z');

function createService() {
  const transactionOptions: Array<{ isolationLevel?: string }> = [];
  const calls: string[] = [];
  const profile = {
    id: profileId,
    nickname: 'Player',
    ageBand: '18+',
    locale: 'ru',
    createdAt: now,
    user: { id: 'user-1', emailNormalized: 'player@example.test', createdAt: now },
  };
  const run = {
    id: 'run-1',
    questVersion: {
      title: 'First Quest',
      quest: { slug: 'first-quest' },
    },
    status: 'COMPLETED',
    attempts: [{ score: 5 }, { score: 10 }],
    levelProgress: [{ id: 'level-progress-1' }],
    startedAt: now,
    completedAt: now,
    lastActivityAt: now,
  };
  const entries = [{
    id: 'ledger-1',
    currency: 'XP',
    amount: 25,
    reason: 'Quest completion',
    sourceType: 'QUEST_COMPLETION',
    createdAt: now,
  }];
  const tx = {
    profile: {
      findUnique: async () => { calls.push('profile'); return profile; },
    },
    questCompletion: {
      count: async () => { calls.push('quest-completions'); return 1; },
    },
    questRun: {
      count: async ({ where }: { where: { status?: string } }) => {
        calls.push(`quest-runs:${where.status}`);
        return where.status === 'COMPLETED' ? 2 : 1;
      },
      findMany: async () => { calls.push('recent-runs'); return [run]; },
    },
    levelProgress: {
      count: async () => { calls.push('level-progress'); return 3; },
    },
    walletLedger: {
      groupBy: async () => {
        calls.push('wallet-balance');
        return [
          { currency: 'XP', _sum: { amount: 125 } },
          { currency: 'COIN', _sum: { amount: 14 } },
        ];
      },
      findMany: async () => { calls.push('wallet-entries'); return entries; },
    },
  };
  const prisma = {
    $transaction: async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel?: string },
    ) => {
      transactionOptions.push(options);
      return callback(tx);
    },
  } as unknown as PrismaService;
  return {
    service: new ProfileService(prisma),
    transactionOptions,
    calls,
    entries,
  };
}

test('getProfile reads wallet and profile statistics in one RepeatableRead snapshot', async () => {
  const { service, transactionOptions, calls } = createService();

  const result = await service.getProfile(profileId) as {
    wallet: { xp: number; coins: number };
    stats: { completedQuests: number; completedRuns: number; activeRuns: number; completedLevels: number };
    progression: { totalXp: number };
  };

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(calls.includes('profile'), true);
  assert.equal(calls.includes('wallet-balance'), true);
  assert.equal(calls.includes('quest-completions'), true);
  assert.equal(result.wallet.xp, 125);
  assert.equal(result.wallet.coins, 14);
  assert.deepEqual(result.stats, {
    completedQuests: 1,
    completedRuns: 2,
    activeRuns: 1,
    completedLevels: 3,
  });
  assert.equal(result.progression.totalXp, 125);
});

test('getProgress reads counters and recent runs from one RepeatableRead snapshot', async () => {
  const { service, transactionOptions, calls } = createService();

  const result = await service.getProgress(profileId) as {
    stats: { completedQuests: number; completedRuns: number; activeRuns: number; completedLevels: number };
    recentRuns: Array<{ id: string; score: number; completedLevels: number }>;
  };

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(calls.includes('recent-runs'), true);
  assert.deepEqual(result.stats, {
    completedQuests: 1,
    completedRuns: 2,
    activeRuns: 1,
    completedLevels: 3,
  });
  assert.deepEqual(result.recentRuns, [{
    id: 'run-1',
    slug: 'first-quest',
    title: 'First Quest',
    status: 'COMPLETED',
    score: 15,
    completedLevels: 1,
    startedAt: now,
    completedAt: now,
    lastActivityAt: now,
  }]);
});

test('getWallet reads ledger balances and displayed entries from the same snapshot', async () => {
  const { service, transactionOptions, calls, entries } = createService();

  const result = await service.getWallet(profileId) as {
    balances: { xp: number; coins: number };
    entries: unknown[];
  };

  assert.deepEqual(transactionOptions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(calls.includes('wallet-balance'), true);
  assert.equal(calls.includes('wallet-entries'), true);
  assert.deepEqual(result.balances, { xp: 125, coins: 14 });
  assert.deepEqual(result.entries, entries);
});
