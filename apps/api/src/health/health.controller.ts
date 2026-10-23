import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Health } from '@shop/shared';
import { HealthService } from './health.service.js';

// A CONTROLLER maps HTTP requests to methods, with decorators instead of router.get(...):
//   @Controller('health') + @Get()  →  GET /api/health   (the /api prefix is set in main.ts)
// Controllers stay thin: the work happens in the service.
// @SkipThrottle(): uptime monitors and load balancers call this every few seconds, from the
// same address; they must never be rate limited.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const result = await this.health.check();
    // 503 when the database is down: load balancers and uptime monitors read the status code
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
