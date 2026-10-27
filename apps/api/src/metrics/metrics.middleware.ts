import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

// Times every request. A MIDDLEWARE (not an interceptor) so it also sees requests that end
// before reaching a controller: refused by a guard (401, 403), rate limited (429), or unknown
// (404).
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.httpDuration.startTimer();
    res.on('finish', () => {
      // Express knows the matched route PATTERN only once routing has happened, so it's read
      // when the response is finished. No match → one shared label, not the raw URL.
      // (Nest answers unknown URLs through its own catch-all route, "*path": also "unmatched")
      const pattern: unknown = (req.route as { path?: unknown } | undefined)?.path;
      const route = typeof pattern === 'string' && !pattern.includes('*') ? `${req.baseUrl}${pattern}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      this.metrics.httpRequests.inc(labels);
      end(labels);
    });
    next();
  }
}
