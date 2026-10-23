import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

// App-wide settings, in one place so the real server (main.ts) and the end-to-end tests
// run exactly the same app
export const setupApp = (app: INestApplication): void => {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Every route lives under /api (GET /api/health), like the web app's /api/* proxy
  app.setGlobalPrefix('api');

  // Browsers may only call the API from the web app's own address
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });

  // On Ctrl+C / a deploy, run onModuleDestroy hooks (e.g. close the database connections)
  app.enableShutdownHooks();
};
