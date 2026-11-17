import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { REQUIRED_ROLES_KEY } from './roles.decorator.js';

const ROLE_IMPLICATIONS: Record<string, string[]> = {
  AUTHOR: ['AUTHOR'],
  REVIEWER: ['AUTHOR', 'REVIEWER'],
  ADMIN: ['AUTHOR', 'REVIEWER', 'ADMIN', 'AUDIT'],
  SUPER_ADMIN: ['AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN', 'AUDIT'],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.authUser as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Sign in is required.');

    const effective = new Set(user.roleKeys.flatMap((role) => ROLE_IMPLICATIONS[role] ?? [role]));
    if (!required.some((role) => effective.has(role))) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
