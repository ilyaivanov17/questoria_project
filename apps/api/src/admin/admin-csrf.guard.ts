import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getWebOrigin } from '../config/web-origin.js';

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;

    const expectedOrigin = getWebOrigin();
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin !== expectedOrigin) {
      throw new ForbiddenException('A valid same-origin request is required.');
    }

    return true;
  }
}
