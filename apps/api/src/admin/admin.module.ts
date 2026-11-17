import { Module } from '@nestjs/common';
import { AdminContentController } from './admin-content.controller.js';
import { AdminMfaController } from './admin-mfa.controller.js';
import { AdminService } from './admin.service.js';
import { AdminMfaService } from './admin-mfa.service.js';
import { AdminCsrfGuard } from './admin-csrf.guard.js';
import { AdminMfaGuard } from './admin-mfa.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  controllers: [AdminContentController, AdminMfaController],
  providers: [AdminService, AdminMfaService, AdminCsrfGuard, AdminMfaGuard, RolesGuard],
})
export class AdminModule {}
