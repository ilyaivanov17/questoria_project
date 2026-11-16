import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { QuestService } from './quest.service.js';

@Controller('v1/public')
export class QuestController {
  constructor(private readonly quests: QuestService) {}

  @Get('categories')
  getCategories(): Promise<object[]> {
    return this.quests.getCategories();
  }

  @Get('quests/:slug')
  async getQuest(@Param('slug') slug: string): Promise<object> {
    const quest = await this.quests.getPublicQuest(slug);
    if (!quest) throw new NotFoundException('Quest not found.');
    return quest;
  }
}
