import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { SkillService } from './skill.service.js';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, SkillService],
})
export class ProfileModule {}
