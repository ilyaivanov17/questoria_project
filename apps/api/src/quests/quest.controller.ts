import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmitDemoAttemptDto } from './dto/submit-demo-attempt.dto.js';
import { QuestService } from './quest.service.js';

@Controller('v1/public')
export class QuestController {
  constructor(private readonly quests: QuestService) {}

  @Get('categories')
  getCategories(): Promise<object[]> {
    return this.quests.getCategories();
  }

  @Get('quests/:slug/preview')
  async getGuestDemoPreview(@Param('slug') slug: string) {
    const preview = await this.quests.getGuestDemoPreview(slug);
    if (!preview) throw new NotFoundException('Quest preview not found.');
    return preview;
  }

  @Post('quests/:slug/preview/attempts')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async submitGuestDemoAttempt(
    @Param('slug') slug: string,
    @Body() dto: SubmitDemoAttemptDto,
  ) {
    const result = await this.quests.submitGuestDemoAttempt(slug, dto);
    if (!result) throw new NotFoundException('Quest preview not found.');
    return result;
  }

  @Get('quests/:slug')
  async getQuest(@Param('slug') slug: string): Promise<object> {
    const quest = await this.quests.getPublicQuest(slug);
    if (!quest) throw new NotFoundException('Quest not found.');
    return quest;
  }
}
