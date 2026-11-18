import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { QuestService } from './quest.service.js';
import { StartRunDto } from './dto/start-run.dto.js';
import { SubmitAttemptDto } from './dto/submit-attempt.dto.js';

@Controller('v1/runs')
@UseGuards(AuthGuard)
export class RunController {
  constructor(private readonly quests: QuestService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Req() request: Request, @Body() dto: StartRunDto): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.quests.startRun(user.profileId, dto);
  }

  @Get(':runId')
  getRun(
    @Req() request: Request,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.quests.getRun(user.profileId, runId);
  }

  @Get(':runId/result')
  getResult(
    @Req() request: Request,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.quests.getRun(user.profileId, runId);
  }

  @Post(':runId/puzzles/:puzzleId/attempts')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  submitAttempt(
    @Req() request: Request,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Param('puzzleId', new ParseUUIDPipe()) puzzleId: string,
    @Body() dto: SubmitAttemptDto,
  ): Promise<object> {
    const user = request.authUser as AuthenticatedUser;
    return this.quests.submitAttempt(user.profileId, runId, puzzleId, dto);
  }
}
