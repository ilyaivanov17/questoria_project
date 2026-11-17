import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import { createOpaqueToken, hashOpaqueToken } from './auth-tokens.js';
import { EmailService } from './email.service.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_TOKEN_DURATION_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_DURATION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ emailSent: boolean }> {
    const emailNormalized = dto.email.trim().toLowerCase();
    const passwordHash = await hashPassword(dto.password);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            emailNormalized,
            passwordHash,
            status: 'PENDING',
            profile: {
              create: {
                nickname: dto.nickname?.trim() || null,
                locale: 'ru',
              },
            },
          },
        });

        const token = createOpaqueToken();
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: token.tokenHash,
            expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_DURATION_MS),
          },
        });

        return { email: user.emailNormalized, token: token.token };
      });

      const emailSent = await this.emailService.sendVerification(created.email, created.token);
      return { emailSent };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<{ token: string; user: object }> {
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: dto.email.trim().toLowerCase() },
      include: { profile: true },
    });

    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    if (user.status === 'PENDING' || !user.emailVerifiedAt) {
      throw new ForbiddenException('Сначала подтверди адрес электронной почты по ссылке из письма.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const token = await this.createSession(user.id);
    return {
      token,
      user: {
        id: user.id,
        email: user.emailNormalized,
        nickname: user.profile?.nickname ?? null,
      },
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const storedToken = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.expiresAt <= now) {
      throw new ForbiddenException('Ссылка недействительна или срок её действия истёк.');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.deleteMany({
        where: { id: storedToken.id, expiresAt: { gt: now } },
      });
      if (consumed.count !== 1) {
        throw new ForbiddenException('Ссылка недействительна или срок её действия истёк.');
      }

      const activated = await tx.user.updateMany({
        where: { id: storedToken.userId, status: 'PENDING' },
        data: { status: 'ACTIVE', emailVerifiedAt: now },
      });
      if (activated.count !== 1) {
        throw new ForbiddenException('Ссылка недействительна или срок её действия истёк.');
      }

      await tx.emailVerificationToken.deleteMany({
        where: { userId: storedToken.userId },
      });
    });

    return { message: 'Электронная почта подтверждена. Теперь можно войти в Questoria.' };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const genericMessage = 'Если аккаунту требуется подтверждение, письмо будет отправлено.';
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email.trim().toLowerCase() },
      select: { id: true, emailNormalized: true, status: true, emailVerifiedAt: true },
    });

    if (!user || user.status !== 'PENDING' || user.emailVerifiedAt) {
      return { message: genericMessage };
    }

    const token = createOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: token.tokenHash,
          expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_DURATION_MS),
        },
      });
    });
    await this.emailService.sendVerification(user.emailNormalized, token.token);

    return { message: genericMessage };
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const genericMessage = 'Если для этого адреса есть активный аккаунт, ссылка для сброса пароля будет отправлена.';
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email.trim().toLowerCase() },
      select: { id: true, emailNormalized: true, status: true, emailVerifiedAt: true },
    });

    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
      return { message: genericMessage };
    }

    const now = new Date();
    const recentToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recentToken) {
      return { message: genericMessage };
    }

    const token = createOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: token.tokenHash,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_DURATION_MS),
        },
      });
    });
    await this.emailService.sendPasswordReset(user.emailNormalized, token.token);

    return { message: genericMessage };
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const storedToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !storedToken ||
      storedToken.expiresAt <= now ||
      storedToken.user.status !== 'ACTIVE' ||
      !storedToken.user.emailVerifiedAt
    ) {
      throw new ForbiddenException('Ссылка недействительна или срок её действия истёк.');
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.deleteMany({
        where: { id: storedToken.id, expiresAt: { gt: now } },
      });
      if (consumed.count !== 1) {
        throw new ForbiddenException('Ссылка недействительна или срок её действия истёк.');
      }

      await tx.user.update({
        where: { id: storedToken.userId },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: storedToken.userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: storedToken.userId } });
    });

    return { message: 'Пароль изменён. Войди в Questoria с новым паролем.' };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      },
    });

    return token;
  }
}
