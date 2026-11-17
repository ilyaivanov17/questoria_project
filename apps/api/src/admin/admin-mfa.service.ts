import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { buildOtpAuthUrl, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpCode } from './totp.js';

@Injectable()
export class AdminMfaService {
  constructor(private readonly prisma: PrismaService) {}

  async setup(user: AuthenticatedUser): Promise<object> {
    const account = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!account) throw new ForbiddenException('Account not found.');
    if (account.mfaEnabledAt) throw new ConflictException('MFA is already enabled; verify a code for this session.');
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.userId },
        data: { mfaSecretEncrypted: encrypted },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: user.userId,
          action: 'security.mfa.setup_started',
          entityType: 'USER',
          entityId: user.userId,
          afterJson: { mfaSetupStarted: true },
        },
      });
    });

    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(user.email, secret),
      instructions: 'Add this secret to an authenticator app, then verify the current six-digit code.',
    };
  }

  async verify(user: AuthenticatedUser, code: string): Promise<object> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { mfaSecretEncrypted: true, mfaEnabledAt: true },
    });
    if (!account?.mfaSecretEncrypted) {
      throw new ConflictException('Start MFA setup before verifying a code.');
    }

    const secret = decryptTotpSecret(account.mfaSecretEncrypted);
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException('The MFA code is invalid or expired.');
    }

    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.userId },
        data: { mfaEnabledAt: account.mfaEnabledAt ?? verifiedAt },
      });
      await tx.session.update({
        where: { id: user.sessionId },
        data: { mfaVerifiedAt: verifiedAt },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: user.userId,
          action: account.mfaEnabledAt ? 'security.mfa.session_verified' : 'security.mfa.enabled',
          entityType: 'USER',
          entityId: user.userId,
          afterJson: { mfaVerifiedAt: verifiedAt.toISOString() },
        },
      });
    });

    return { verified: true, mfaEnabled: true, verifiedAt };
  }
}
