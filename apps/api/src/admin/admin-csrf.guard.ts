import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;

    const expectedOrigin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000').origin;
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin !== expectedOrigin) {
      throw new ForbiddenException('A valid same-origin request is required.');
    }

    return true;
  }
}
