import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import {
  EmailAddressDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/account-actions.dto.js';

const COOKIE_NAME = 'questoria_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setSessionCookie(response: Response, token: string): void {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<{ message: string; emailSent: boolean }> {
    const result = await this.authService.register(dto);
    return {
      message: result.emailSent
        ? 'Аккаунт создан. Проверь почту и перейди по ссылке для подтверждения адреса.'
        : 'Аккаунт создан, но письмо не удалось отправить. Попробуй запросить его повторно.',
      emailSent: result.emailSent,
    };
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(@Body() dto: EmailAddressDto): Promise<{ message: string }> {
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() dto: EmailAddressDto): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: object }> {
    const result = await this.authService.login(dto);
    setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const user = request.authUser as AuthenticatedUser;
    await this.authService.logout(user.sessionId);
    clearSessionCookie(response);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@Req() request: Request): { user: object } {
    const user = request.authUser as AuthenticatedUser;
    return {
      user: {
        id: user.userId,
        email: user.email,
        nickname: user.nickname,
        roles: user.roleKeys,
        mfaEnabled: user.mfaEnabled,
        mfaVerified: user.sessionMfaVerified,
      },
    };
  }
}
