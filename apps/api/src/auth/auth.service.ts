import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto): Promise<{ token: string; user: object }> {
    const emailNormalized = dto.email.trim().toLowerCase();
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          emailNormalized,
          passwordHash,
          status: 'ACTIVE',
          profile: {
            create: {
              nickname: dto.nickname?.trim() || null,
              locale: 'ru',
            },
          },
        },
        include: { profile: true },
      });

      const token = await this.createSession(user.id);
      return {
        token,
        user: {
          id: user.id,
          email: user.emailNormalized,
          nickname: user.profile?.nickname ?? null,
        },
      };
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

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await verifyPassword(dto.password, user.passwordHash))
    ) {
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
