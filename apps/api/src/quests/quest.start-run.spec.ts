import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { QuestService } from './quest.service.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const version = { id: '22222222-2222-4222-8222-222222222222' };

function createService(options: {
  existingRun?: { id: string } | null;
  profileExists?: boolean;
}) {
  const events: string[] = [];
  let createCount = 0;
  const run = options.existingRun ?? null;

  const tx = {
    $queryRaw: async () => {
      events.push('profile-lock');
      return options.profileExists === false ? [] : [{ id: profileId }];
    },
    questRun: {
      findFirst: async () => {
        events.push('find-active-run');
        return run;
      },
      create: async () => {
        events.push('create-run');
        createCount += 1;
        return { id: '33333333-3333-4333-8333-333333333333' };
      },
    },
  };
  const prisma = {
    questVersion: { findFirst: async () => version },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  const service = new QuestService(prisma);
  (service as unknown as {
    getRun: (ownerId: string, runId: string) => Promise<object>;
  }).getRun = async (ownerId, runId) => {
    events.push('load-run');
    return { profileId: ownerId, runId };
  };

  return { service, events, getCreateCount: () => createCount };
}

test('startRun locks the profile before looking up and reuses the active run', async () => {
  const activeRun = { id: '44444444-4444-4444-8444-444444444444' };
  const { service, events, getCreateCount } = createService({ existingRun: activeRun });

  const result = await service.startRun(profileId, { slug: 'published-quest' });

  assert.deepEqual(events, ['profile-lock', 'find-active-run', 'load-run']);
  assert.equal(getCreateCount(), 0);
  assert.deepEqual(result, { profileId, runId: activeRun.id });
});

test('startRun creates a run only after acquiring the profile lock and confirming none exists', async () => {
  const { service, events, getCreateCount } = createService({ existingRun: null });

  const result = await service.startRun(profileId, { slug: 'published-quest' });

  assert.deepEqual(events, ['profile-lock', 'find-active-run', 'create-run', 'load-run']);
  assert.equal(getCreateCount(), 1);
  assert.deepEqual(result, {
    profileId,
    runId: '33333333-3333-4333-8333-333333333333',
  });
});

test('startRun rejects a missing profile before creating a run', async () => {
  const { service, events, getCreateCount } = createService({ profileExists: false });

  await assert.rejects(
    () => service.startRun(profileId, { slug: 'published-quest' }),
    NotFoundException,
  );

  assert.deepEqual(events, ['profile-lock']);
  assert.equal(getCreateCount(), 0);
});
