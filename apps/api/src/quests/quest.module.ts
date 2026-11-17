import { Module } from '@nestjs/common';
import { QuestController } from './quest.controller.js';
import { RunController } from './run.controller.js';
import { QuestService } from './quest.service.js';

@Module({
  controllers: [QuestController, RunController],
  providers: [QuestService],
})
export class QuestModule {}
