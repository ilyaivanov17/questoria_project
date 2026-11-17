import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { buildAuditLogWhere, parseAuditLogQuery } from './audit-log.query.js';

test('parses a bounded audit page and inclusive UTC date range', () => {
  const parsed = parseAuditLogQuery({
    take: '25',
    skip: '50',
    from: '2026-11-01',
    to: '2026-11-17',
  });

  assert.equal(parsed.take, 25);
  assert.equal(parsed.skip, 50);
  assert.equal(parsed.filters.from?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(parsed.filters.to?.toISOString(), '2026-11-17T23:59:59.999Z');
});

test('rejects invalid pagination, invalid calendar dates and reversed ranges', () => {
  assert.throws(() => parseAuditLogQuery({ take: '0' }), BadRequestException);
  assert.throws(() => parseAuditLogQuery({ skip: '-1' }), BadRequestException);
  assert.throws(() => parseAuditLogQuery({ from: '2026-02-30' }), BadRequestException);
  assert.throws(() => parseAuditLogQuery({ from: '2026-11-18', to: '2026-11-17' }), BadRequestException);
  assert.throws(() => parseAuditLogQuery({ q: 'x'.repeat(201) }), BadRequestException);
});

test('builds combined audit filters for action, actor, entity and free-text search', () => {
  const parsed = parseAuditLogQuery({
    action: 'security.',
    actor: 'admin@example.test',
    entityType: 'USER',
    q: 'revoked',
  });
  const where = buildAuditLogWhere(parsed.filters);

  assert.deepEqual(where, {
    AND: [
      { action: { contains: 'security.', mode: 'insensitive' } },
      { actor: { is: { emailNormalized: { contains: 'admin@example.test', mode: 'insensitive' } } } },
      { entityType: { equals: 'USER', mode: 'insensitive' } },
      {
        OR: [
          { action: { contains: 'revoked', mode: 'insensitive' } },
          { entityType: { contains: 'revoked', mode: 'insensitive' } },
          { entityId: { contains: 'revoked', mode: 'insensitive' } },
          { reason: { contains: 'revoked', mode: 'insensitive' } },
          { actor: { is: { emailNormalized: { contains: 'revoked', mode: 'insensitive' } } } },
        ],
      },
    ],
  });
});
