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
import { AchievementService } from './achievement.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfileService } from './profile.service.js';
import { SkillService } from './skill.service.js';

@Controller('v1/me')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly skills: SkillService,
    private readonly achievements: AchievementService,
  ) {}

  @Get('profile')
  async getProfile(@Req() request: Request): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    const [profile, achievementProgress] = await Promise.all([
      this.profiles.getProfile(user.profileId),
      this.achievements.getAchievements(user.profileId),
    ]);

    const profileData = profile as {
      [key: string]: unknown;
      progression?: { [key: string]: unknown };
    };
    const progression = profileData.progression ?? {};
    const achievementCards = achievementProgress.achievements.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      icon: achievement.icon,
      unlocked: achievement.unlocked,
    }));

    return {
      ...profileData,
      progression: {
        ...progression,
        achievements: achievementCards,
        unlockedAchievements: achievementProgress.unlockedCount,
      },
      achievementHistory: achievementProgress.history,
    };
  }

  @Get('achievements')
  getAchievements(@Req() request: Request) {
    const user = request.authUser as AuthenticatedUser;
    return this.achievements.getAchievements(user.profileId);
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

  @Get('skills')
  getSkills(@Req() request: Request) {
    const user = request.authUser as AuthenticatedUser;
    return this.skills.getSkills(user.profileId);
  }
}
