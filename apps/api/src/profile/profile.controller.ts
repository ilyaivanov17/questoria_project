import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfileService } from './profile.service.js';

@Controller('v1/me')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  getProfile(@Req() request: Request): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.profiles.getProfile(user.profileId);
  }

  @Patch('profile')
  updateProfile(
    @Req() request: Request,
    @Body() dto: UpdateProfileDto,
  ): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.profiles.updateProfile(user.profileId, dto);
  }

  @Get('progress')
  getProgress(@Req() request: Request): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.profiles.getProgress(user.profileId);
  }

  @Get('wallet')
  getWallet(@Req() request: Request): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.profiles.getWallet(user.profileId);
  }
}
