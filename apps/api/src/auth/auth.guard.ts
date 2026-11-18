import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseSessionCookie } from './session-cookie.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = parseSessionCookie(request.headers.cookie);
    if (!rawToken) {
      throw new UnauthorizedException('Please sign in to continue.');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            profile: true,
            roles: { include: { role: true } },
          },
        },
      },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE' ||
      !session.user.emailVerifiedAt ||
      !session.user.profile
    ) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    request.authUser = {
      userId: session.user.id,
      profileId: session.user.profile.id,
      sessionId: session.id,
      email: session.user.emailNormalized,
      nickname: session.user.profile.nickname,
      roleKeys: session.user.roles.map((entry) => entry.role.key),
      mfaEnabled: Boolean(session.user.mfaEnabledAt),
      sessionMfaVerified: Boolean(session.mfaVerifiedAt),
    };

    return true;
  }
}
