import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

// The root module: the app is the tree of modules imported from here
@Module({
  imports: [
    // Reads .env (.env.test when testing: Vitest sets NODE_ENV=test), checks it with validateEnv
    // (the app won't start with bad settings), and makes ConfigService available everywhere.
    // Real environment variables win over the file, which is how CI and hosting pass settings.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
