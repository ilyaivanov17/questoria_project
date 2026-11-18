import { Module } from '@nestjs/common';
import { AchievementService } from './achievement.service.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, AchievementService],
})
export class ProfileModule {}
