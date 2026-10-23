import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/setup-app.js';
import { ConventionsTestController } from './conventions.controller.js';

// The real app (AppModule + setupApp, exactly like main.ts), plus the test-only endpoints
export const createTestApp = async (): Promise<NestExpressApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ConventionsTestController],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  setupApp(app);
  await app.init();
  return app;
};
