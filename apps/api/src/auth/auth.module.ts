import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { EmailService } from './email.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, EmailService],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
