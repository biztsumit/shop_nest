import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.js';

// An id like "3f2c9a1e-..." for every request, sent back in the X-Request-Id header and
// written in its log line. A shopper (or the web app) can quote it, and we find the exact request.
// A trusted caller (the web server) may pass its own id along, but only if it looks like one:
// whatever lands in the logs must not be able to fake log lines.
const REQUEST_ID = /^[\w-]{8,64}$/;

const requestId = (req: IncomingMessage, res: ServerResponse): string => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
};

// STRUCTURED logging with pino: each line is JSON ({"level":30,"reqId":"…","res":{"statusCode":200}})
// so log tools can search and count by any field. In development it's printed in colour instead.
export const loggingModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      genReqId: requestId,
      // One line per request: errors at "error", client mistakes at "warn", the rest at "info"
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Only what's useful, and never secrets: no headers (cookies, tokens), no bodies (passwords)
      serializers: {
        // `raw` is the Express request: its `ip` respects TRUST_PROXY, so behind the Next.js
        // proxy it's the shopper's address, not the proxy's
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string; raw?: { ip?: string } }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.raw?.ip ?? req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Health checks come every few seconds from monitors: logging each would bury the rest
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' },
      ...(config.get('NODE_ENV', { infer: true }) === 'development' && {
        transport: { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } },
      }),
    },
  }),
});
