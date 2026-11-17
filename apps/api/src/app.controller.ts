import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthReadinessResponse, HealthResponse } from '@questoria/contracts';
import { PrismaService } from './prisma/prisma.service.js';

@Controller('health')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'questoria-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async getReadiness(): Promise<HealthReadinessResponse> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'questoria-api',
        timestamp: new Date().toISOString(),
        checks: { database: 'unavailable' },
      });
    }

    return {
      status: 'ready',
      service: 'questoria-api',
      timestamp: new Date().toISOString(),
      checks: { database: 'ok' },
    };
  }
}
