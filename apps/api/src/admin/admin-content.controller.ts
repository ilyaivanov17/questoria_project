import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AdminService } from './admin.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import { CreateQuestDto, UpdateQuestDto } from './dto/quest.dto.js';
import { AdminCsrfGuard } from './admin-csrf.guard.js';
import { AdminMfaGuard } from './admin-mfa.guard.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Controller('v1/admin')
@UseGuards(AuthGuard, RolesGuard, AdminMfaGuard, AdminCsrfGuard)
export class AdminContentController {
  constructor(private readonly admin: AdminService) {}

  @Get('categories')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listCategories(): Promise<object[]> {
    return this.admin.listCategories();
  }

  @Post('categories')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  createCategory(@Req() request: Request, @Body() dto: CreateCategoryDto): Promise<object> {
    return this.admin.createCategory(request.authUser as AuthenticatedUser, dto);
  }

  @Patch('categories/:id')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  updateCategory(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<object> {
    return this.admin.updateCategory(request.authUser as AuthenticatedUser, id, dto);
  }

  @Delete('categories/:id')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  archiveCategory(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.archiveCategory(request.authUser as AuthenticatedUser, id);
  }

  @Post('categories/:id/publish')
  @Roles('ADMIN', 'SUPER_ADMIN')
  publishCategory(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.publishCategory(request.authUser as AuthenticatedUser, id);
  }

  @Get('quests')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listQuests(): Promise<object[]> {
    return this.admin.listQuests();
  }

  @Post('quests')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  createQuest(@Req() request: Request, @Body() dto: CreateQuestDto): Promise<object> {
    return this.admin.createQuest(request.authUser as AuthenticatedUser, dto);
  }

  @Get('quests/:id')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  getQuest(@Param('id', new ParseUUIDPipe()) id: string): Promise<object> {
    return this.admin.getQuest(id);
  }

  @Patch('quests/:id')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  updateQuest(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateQuestDto,
  ): Promise<object> {
    return this.admin.updateQuest(request.authUser as AuthenticatedUser, id, dto);
  }

  @Post('quests/:id/draft')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  createDraft(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.createDraft(request.authUser as AuthenticatedUser, id);
  }

  @Post('quests/:id/submit-review')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  submitForReview(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.submitForReview(request.authUser as AuthenticatedUser, id);
  }

  @Post('quests/:id/approve')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  approveQuest(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.approveQuest(request.authUser as AuthenticatedUser, id);
  }

  @Post('quests/:id/publish')
  @Roles('ADMIN', 'SUPER_ADMIN')
  publishQuest(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.publishQuest(request.authUser as AuthenticatedUser, id);
  }

  @Get('audit-logs')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listAuditLogs(@Query('take') take?: string): Promise<object[]> {
    const parsed = take === undefined ? 50 : Number(take);
    return this.admin.listAuditLogs(Number.isFinite(parsed) ? parsed : 50);
  }
}
