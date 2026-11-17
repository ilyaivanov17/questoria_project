import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/;
const accessLogger = new Logger('HttpAccess');

export function resolveRequestId(value: string | string[] | undefined): string {
  if (typeof value === 'string' && SAFE_REQUEST_ID.test(value)) {
    return value;
  }
  return randomUUID();
}

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
  const startedAt = Date.now();

  response.setHeader(REQUEST_ID_HEADER, requestId);
  response.once('finish', () => {
    const routePath = request.route?.path;
    const route = routePath === undefined
      ? request.baseUrl || 'unmatched'
      : request.baseUrl + String(routePath);
    const entry = {
      event: 'http.request',
      requestId,
      method: request.method,
      route,
      statusCode: response.statusCode,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
    const line = JSON.stringify(entry);

    if (response.statusCode >= 500) {
      accessLogger.error(line);
    } else {
      accessLogger.log(line);
    }
  });

  next();
}
