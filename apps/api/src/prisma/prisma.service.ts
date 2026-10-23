import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

// The database client, as a Nest PROVIDER: Nest creates ONE instance and hands it to every
// class that asks for it in its constructor (dependency injection). Nobody calls `new`.
//
// It IS a PrismaClient (extends), so services use it directly: this.prisma.product.findMany()
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    // Prisma 7 talks to PostgreSQL through a "driver adapter": here the standard `pg` driver
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }) });
  }

  // Lifecycle hooks: Nest calls these when the app starts and stops
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
