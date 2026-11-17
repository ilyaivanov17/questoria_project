import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller.js';
import type { PrismaService } from './prisma/prisma.service.js';

test('readiness succeeds when PostgreSQL answers the health query', async () => {
  const prisma = {
    $queryRawUnsafe: async () => [{ '?column?': 1 }],
  } as unknown as PrismaService;
  const controller = new AppController(prisma);

  const result = await controller.getReadiness();

  assert.equal(result.status, 'ready');
  assert.equal(result.service, 'questoria-api');
  assert.equal(result.checks.database, 'ok');
  assert.ok(Number.isFinite(Date.parse(result.timestamp)));
});

test('readiness returns a generic 503 without exposing database errors', async () => {
  const prisma = {
    $queryRawUnsafe: async () => {
      throw new Error('postgres://private-host/secret-database');
    },
  } as unknown as PrismaService;
  const controller = new AppController(prisma);

  await assert.rejects(controller.getReadiness(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    const response = JSON.stringify(error.getResponse());
    assert.match(response, /unavailable/);
    assert.doesNotMatch(response, /private-host|secret-database/);
    return true;
  });
});
