import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@questoria/contracts';

@Controller('health')
export class AppController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'questoria-api',
      timestamp: new Date().toISOString(),
    };
  }
}
