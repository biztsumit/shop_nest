import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

// The root module: the app is the tree of modules imported from here
@Module({
  imports: [
    // Reads .env, checks it with validateEnv (the app won't start with bad settings), and makes
    // ConfigService available everywhere
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
