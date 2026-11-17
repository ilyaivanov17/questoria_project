import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  buildOtpAuthUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from './totp.js';
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from './mfa-recovery.js';

@Injectable()
export class AdminMfaService {
  constructor(private readonly prisma: PrismaService) {}

  async setup(user: AuthenticatedUser): Promise<object> {
    const account = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!account) throw new ForbiddenException('Account not found.');
    if (account.mfaEnabledAt) {
      throw new ConflictException('MFA is already enabled; verify a code for this session.');
    }

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
    const enabling = account.mfaEnabledAt === null;
    const recovery = enabling ? generateMfaRecoveryCodes() : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.userId },
        data: { mfaEnabledAt: account.mfaEnabledAt ?? verifiedAt },
      });
      await tx.session.update({
        where: { id: user.sessionId },
        data: { mfaVerifiedAt: verifiedAt },
      });

      if (recovery) {
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.userId } });
        await tx.mfaRecoveryCode.createMany({
          data: recovery.hashes.map((codeHash) => ({ userId: user.userId, codeHash })),
        });
      }

      await tx.adminAuditLog.create({
        data: {
          actorUserId: user.userId,
          action: enabling ? 'security.mfa.enabled' : 'security.mfa.session_verified',
          entityType: 'USER',
          entityId: user.userId,
          afterJson: recovery
            ? {
                mfaVerifiedAt: verifiedAt.toISOString(),
                recoveryCodesGenerated: true,
                recoveryCodeCount: recovery.codes.length,
              }
            : { mfaVerifiedAt: verifiedAt.toISOString() },
        },
      });
    });

    return {
      verified: true,
      mfaEnabled: true,
      verifiedAt,
      ...(recovery ? { recoveryCodes: recovery.codes, recoveryCodesRemaining: recovery.codes.length } : {}),
    };
  }

  async recoveryCodeStatus(user: AuthenticatedUser): Promise<object> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { mfaEnabledAt: true },
    });
    if (!account?.mfaEnabledAt) {
      throw new ConflictException('MFA is not enabled for this account.');
    }

    const remaining = await this.prisma.mfaRecoveryCode.count({
      where: { userId: user.userId },
    });
    return { enabled: true, remaining };
  }

  async useRecoveryCode(user: AuthenticatedUser, code: string): Promise<object> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { mfaEnabledAt: true },
    });
    if (!account?.mfaEnabledAt) {
      throw new ConflictException('MFA is not enabled for this account.');
    }

    let codeHash: string;
    try {
      codeHash = hashMfaRecoveryCode(code);
    } catch {
      throw new UnauthorizedException('The MFA recovery code is invalid or has already been used.');
    }

    const verifiedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.mfaRecoveryCode.deleteMany({
        where: { userId: user.userId, codeHash },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('The MFA recovery code is invalid or has already been used.');
      }

      const updatedSession = await tx.session.updateMany({
        where: { id: user.sessionId, userId: user.userId },
        data: { mfaVerifiedAt: verifiedAt },
      });
      if (updatedSession.count !== 1) {
        throw new UnauthorizedException('The current session is no longer available.');
      }

      const remaining = await tx.mfaRecoveryCode.count({
        where: { userId: user.userId },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: user.userId,
          action: 'security.mfa.recovery_code.used',
          entityType: 'USER',
          entityId: user.userId,
          afterJson: { usedAt: verifiedAt.toISOString(), remaining },
        },
      });
      return { remaining };
    });

    return { verified: true, verifiedAt, remaining: result.remaining };
  }

  async regenerateRecoveryCodes(user: AuthenticatedUser, code: string): Promise<object> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { mfaSecretEncrypted: true, mfaEnabledAt: true },
    });
    if (!account?.mfaEnabledAt || !account.mfaSecretEncrypted) {
      throw new ConflictException('MFA is not enabled for this account.');
    }

    const secret = decryptTotpSecret(account.mfaSecretEncrypted);
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException('The MFA code is invalid or expired.');
    }

    const recovery = generateMfaRecoveryCodes();
    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recovery.hashes.map((codeHash) => ({ userId: user.userId, codeHash })),
      });
      await tx.session.updateMany({
        where: { id: user.sessionId, userId: user.userId },
        data: { mfaVerifiedAt: verifiedAt },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: user.userId,
          action: 'security.mfa.recovery_codes.regenerated',
          entityType: 'USER',
          entityId: user.userId,
          afterJson: { generatedAt: verifiedAt.toISOString(), count: recovery.codes.length },
        },
      });
    });

    return {
      codes: recovery.codes,
      remaining: recovery.codes.length,
      generatedAt: verifiedAt,
    };
  }
}
