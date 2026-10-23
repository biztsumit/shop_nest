import { Injectable } from '@nestjs/common';
import type { Health } from '@shop/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HealthService {
  // Dependency injection: Nest sees PrismaService in the constructor and passes the one
  // shared instance. In a test, a fake one can be passed instead.
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<Health> {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(() => 'up' as const, () => 'down' as const);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.floor(process.uptime()),
      // npm sets this when the app is started through an npm script
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
