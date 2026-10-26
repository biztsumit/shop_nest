import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ProblemFilter } from './common/problem.filter.js';
import { validationPipe } from './common/validation.js';
import type { Env } from './config/env.js';

// App-wide settings, in one place so the real server (main.ts) and the end-to-end tests
// run exactly the same app
export const setupApp = (app: NestExpressApplication): void => {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // All of Nest's own messages (startup, errors) go through pino too, as structured JSON
  app.useLogger(app.get(Logger));

  // Every route lives under /api (GET /api/health), like the web app's /api/* proxy
  app.setGlobalPrefix('api');

  // Reads the Cookie header into req.cookies (the login cookie: see auth/session-cookie.ts)
  app.use(cookieParser());

  // Security headers on every response (no MIME sniffing, no framing, strict HTTPS...)
  app.use(helmet());

  // Which proxies may report the client's real IP: needed for correct rate limits and logs
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  // Browsers may only call the API from the web app's own address
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });

  // Every parameter declared with a schema (@Body({ schema })) is checked, failures become 422
  app.useGlobalPipes(validationPipe());

  // Every error, from anywhere, leaves as one Problem Details response
  app.useGlobalFilters(new ProblemFilter());

  // On Ctrl+C / a deploy, run onModuleDestroy hooks (e.g. close the database connections)
  app.enableShutdownHooks();
};
