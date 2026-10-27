import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import { MetricsService } from './metrics.service.js';

// GET /api/metrics, in the Prometheus text format. Read by a monitoring system, not people.
// Metrics reveal how busy the shop is, so it needs its own token (METRICS_TOKEN); without one
// configured, the endpoint simply doesn't exist.
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  async read(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) res: Response): Promise<string> {
    const token = this.config.get('METRICS_TOKEN', { infer: true });
    if (!token) throw new NotFoundException();
    if (!sameSecret(authorization ?? '', `Bearer ${token}`)) {
      throw new UnauthorizedException('This needs the metrics token.');
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}

// Compares in constant time (hashing first makes the lengths equal, as timingSafeEqual needs)
const sameSecret = (given: string, expected: string): boolean =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
