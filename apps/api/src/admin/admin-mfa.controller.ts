import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { VerifyMfaDto } from './dto/mfa.dto.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { AdminCsrfGuard } from './admin-csrf.guard.js';
import { AdminMfaService } from './admin-mfa.service.js';

@Controller('v1/admin')
@UseGuards(AuthGuard, RolesGuard, AdminCsrfGuard)
@Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
export class AdminMfaController {
  constructor(private readonly mfa: AdminMfaService) {}

  @Get('me')
  getMe(@Req() request: Request): object {
    return {
      user: request.authUser,
    };
  }

  @Post('mfa/setup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setup(@Req() request: Request): Promise<object> {
    return this.mfa.setup(request.authUser as AuthenticatedUser);
  }

  @Post('mfa/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verify(@Req() request: Request, @Body() dto: VerifyMfaDto): Promise<object> {
    return this.mfa.verify(request.authUser as AuthenticatedUser, dto.code);
  }
}
