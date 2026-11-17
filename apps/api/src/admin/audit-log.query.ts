import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export type AuditLogFilters = {
  q?: string;
  action?: string;
  actor?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
};

export type RawAuditLogQuery = {
  take?: string;
  skip?: string;
  q?: string;
  action?: string;
  actor?: string;
  entityType?: string;
  from?: string;
  to?: string;
};

export type ParsedAuditLogQuery = {
  take: number;
  skip: number;
  filters: AuditLogFilters;
};

export const AUDIT_LOG_PAGE_SIZE = 30;
export const AUDIT_LOG_EXPORT_LIMIT = 5_000;

function optionalText(value: string | undefined, field: string, maxLength = 120): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new BadRequestException(field + ' filter is too long.');
  }
  return trimmed;
}

function parsePageNumber(value: string | undefined, fallback: number, field: string, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new BadRequestException(field + ' must be a whole number.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new BadRequestException(field + ' is outside the allowed range.');
  }
  return parsed;
}

function parseAuditDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Audit dates must use YYYY-MM-DD.');
  }
  const date = new Date(value + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'));
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Audit date is invalid.');
  }
  return date;
}

export function parseAuditLogQuery(raw: RawAuditLogQuery): ParsedAuditLogQuery {
  const take = parsePageNumber(raw.take, AUDIT_LOG_PAGE_SIZE, 'take', 100);
  if (take < 1) throw new BadRequestException('take must be at least 1.');
  const skip = parsePageNumber(raw.skip, 0, 'skip', 100_000);
  const from = parseAuditDate(raw.from, false);
  const to = parseAuditDate(raw.to, true);
  if (from && to && from > to) {
    throw new BadRequestException('The start date must not be after the end date.');
  }

  return {
    take,
    skip,
    filters: {
      q: optionalText(raw.q, 'Search', 200),
      action: optionalText(raw.action, 'Action', 120),
      actor: optionalText(raw.actor, 'Actor', 254),
      entityType: optionalText(raw.entityType, 'Entity type', 60),
      from,
      to,
    },
  };
}

export function buildAuditLogWhere(filters: AuditLogFilters): Prisma.AdminAuditLogWhereInput {
  const clauses: Prisma.AdminAuditLogWhereInput[] = [];
  if (filters.action) {
    clauses.push({ action: { contains: filters.action, mode: 'insensitive' } });
  }
  if (filters.actor) {
    clauses.push({
      actor: { is: { emailNormalized: { contains: filters.actor, mode: 'insensitive' } } },
    });
  }
  if (filters.entityType) {
    clauses.push({ entityType: { equals: filters.entityType, mode: 'insensitive' } });
  }
  if (filters.from || filters.to) {
    clauses.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }
  if (filters.q) {
    clauses.push({
      OR: [
        { action: { contains: filters.q, mode: 'insensitive' } },
        { entityType: { contains: filters.q, mode: 'insensitive' } },
        { entityId: { contains: filters.q, mode: 'insensitive' } },
        { reason: { contains: filters.q, mode: 'insensitive' } },
        { actor: { is: { emailNormalized: { contains: filters.q, mode: 'insensitive' } } } },
      ],
    });
  }

  return clauses.length ? { AND: clauses } : {};
}
