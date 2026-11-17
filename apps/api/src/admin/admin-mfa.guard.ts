import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Injectable()
export class AdminMfaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.authUser as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Sign in is required.');

    const needsMfa = user.roleKeys.includes('ADMIN') || user.roleKeys.includes('SUPER_ADMIN');
    if (!needsMfa) return true;

    if (!user.mfaEnabled) {
      throw new ForbiddenException('Set up administrator MFA before using the CMS.');
    }
    if (!user.sessionMfaVerified) {
      throw new ForbiddenException('Verify your administrator MFA code for this session.');
    }

    return true;
  }
}
