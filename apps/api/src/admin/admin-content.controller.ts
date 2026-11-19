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
import { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto.js';
import { AssignQuestReviewerDto, BulkAssignQuestReviewerDto, BulkSubmitQuestReviewDto, CreateQuestDto, RequestQuestChangesDto, UpdateQuestDto } from './dto/quest.dto.js';
import { AssignUserRoleDto, RemoveUserRoleDto, RevokeUserSessionDto, UpdateManagedUserStatusDto } from './dto/user-management.dto.js';
import { AdminCsrfGuard } from './admin-csrf.guard.js';
import { AdminMfaGuard } from './admin-mfa.guard.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { parseAuditLogQuery } from './audit-log.query.js';

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

  @Get('skills')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listSkills(): Promise<object[]> {
    return this.admin.listSkills();
  }

  @Get('analytics/learning')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  getLearningAnalytics(): Promise<object> {
    return this.admin.getLearningAnalytics();
  }


  @Get('analytics/learning/tasks')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  getTaskLearningAnalytics(): Promise<object> {
    return this.admin.getTaskLearningAnalytics();
  }

  @Post('skills')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createSkill(@Req() request: Request, @Body() dto: CreateSkillDto): Promise<object> {
    return this.admin.createSkill(request.authUser as AuthenticatedUser, dto);
  }

  @Patch('skills/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateSkill(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<object> {
    return this.admin.updateSkill(request.authUser as AuthenticatedUser, id, dto);
  }

  @Get('notifications')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listEditorialNotifications(@Req() request: Request): Promise<object> {
    return this.admin.listEditorialNotifications(request.authUser as AuthenticatedUser);
  }

  @Post('notifications/read-all')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  markAllEditorialNotificationsRead(@Req() request: Request): Promise<object> {
    return this.admin.markAllEditorialNotificationsRead(request.authUser as AuthenticatedUser);
  }

  @Patch('notifications/:id/read')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  markEditorialNotificationRead(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.markEditorialNotificationRead(request.authUser as AuthenticatedUser, id);
  }

  @Get('reviewers')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listQuestReviewers(): Promise<object[]> {
    return this.admin.listQuestReviewers();
  }

  @Get('quests')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listQuests(@Req() request: Request): Promise<object[]> {
    return this.admin.listQuests(request.authUser as AuthenticatedUser);
  }

  @Post('quests')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  createQuest(@Req() request: Request, @Body() dto: CreateQuestDto): Promise<object> {
    return this.admin.createQuest(request.authUser as AuthenticatedUser, dto);
  }

  @Get('quests/:id')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  getQuest(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.getQuest(request.authUser as AuthenticatedUser, id);
  }

  @Get('quests/:id/versions')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  getQuestVersions(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.getQuestVersions(request.authUser as AuthenticatedUser, id);
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

  @Post('quests/bulk-submit-review')
  @Roles('AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  bulkSubmitForReview(
    @Req() request: Request,
    @Body() dto: BulkSubmitQuestReviewDto,
  ): Promise<object> {
    return this.admin.bulkSubmitForReview(request.authUser as AuthenticatedUser, dto.questIds);
  }

  @Patch('quests/:id/reviewer')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  assignQuestReviewer(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignQuestReviewerDto,
  ): Promise<object> {
    return this.admin.assignQuestReviewer(request.authUser as AuthenticatedUser, id, dto.reviewerId);
  }

  @Post('quests/bulk-assign-reviewer')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  bulkAssignQuestReviewer(
    @Req() request: Request,
    @Body() dto: BulkAssignQuestReviewerDto,
  ): Promise<object> {
    return this.admin.bulkAssignQuestReviewer(
      request.authUser as AuthenticatedUser,
      dto.questIds,
      dto.reviewerId,
    );
  }

  @Post('quests/:id/request-changes')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  requestQuestChanges(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestQuestChangesDto,
  ): Promise<object> {
    return this.admin.requestQuestChanges(request.authUser as AuthenticatedUser, id, dto.feedback);
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


  @Get('users')
  @Roles('SUPER_ADMIN')
  listUsers(@Query('search') search?: string): Promise<object[]> {
    return this.admin.listUsers(search);
  }

  @Post('users/:id/roles')
  @Roles('SUPER_ADMIN')
  assignUserRole(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignUserRoleDto,
  ): Promise<object> {
    return this.admin.assignUserRole(request.authUser as AuthenticatedUser, id, dto.role, dto.reason);
  }

  @Delete('users/:id/roles/:roleKey')
  @Roles('SUPER_ADMIN')
  removeUserRole(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('roleKey') roleKey: string,
    @Body() dto: RemoveUserRoleDto,
  ): Promise<object> {
    return this.admin.removeUserRole(request.authUser as AuthenticatedUser, id, roleKey, dto.reason);
  }

  @Patch('users/:id/status')
  @Roles('SUPER_ADMIN')
  updateUserStatus(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateManagedUserStatusDto,
  ): Promise<object> {
    return this.admin.updateUserStatus(request.authUser as AuthenticatedUser, id, dto.status, dto.reason);
  }

  @Get('users/:id/sessions')
  @Roles('SUPER_ADMIN')
  listUserSessions(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<object> {
    return this.admin.listUserSessions(request.authUser as AuthenticatedUser, id);
  }

  @Delete('users/:id/sessions/:sessionId')
  @Roles('SUPER_ADMIN')
  revokeUserSession(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() dto: RevokeUserSessionDto,
  ): Promise<object> {
    return this.admin.revokeUserSession(request.authUser as AuthenticatedUser, id, sessionId, dto.reason);
  }

  @Post('users/:id/sessions/revoke-others')
  @Roles('SUPER_ADMIN')
  revokeOtherUserSessions(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeUserSessionDto,
  ): Promise<object> {
    return this.admin.revokeOtherUserSessions(request.authUser as AuthenticatedUser, id, dto.reason);
  }

  @Get('audit-logs/export')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  exportAuditLogs(
    @Query('q') q?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<object> {
    const { filters } = parseAuditLogQuery({ q, action, actor, entityType, from, to });
    return this.admin.exportAuditLogs(filters);
  }

  @Get('audit-logs')
  @Roles('REVIEWER', 'ADMIN', 'SUPER_ADMIN')
  listAuditLogs(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('q') q?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<object> {
    const parsed = parseAuditLogQuery({ take, skip, q, action, actor, entityType, from, to });
    return this.admin.listAuditLogs(parsed.filters, parsed.take, parsed.skip);
  }
}
