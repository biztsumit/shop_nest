import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Problem } from '@shop/shared';
import type { Request, Response } from 'express';
import { ValidationFailedException } from './validation.js';

// Short titles for the HTTP errors we expect (RFC 9457: the title doesn't change between
// occurrences; the detail explains this one)
const TITLES: Partial<Record<number, string>> = {
  400: 'Bad request',
  401: 'Not logged in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  413: 'Request too large',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

// An EXCEPTION FILTER catches whatever a request threw and turns it into the response.
// @Catch() with nothing inside = every error, so the API has ONE error format, whether it came
// from our code (throw new NotFoundException(...)), from Nest (unknown route, bad JSON), from
// the rate limiter, or from a bug.
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const problem: Problem = {
      type: typeFor(exception, status),
      title: TITLES[status] ?? 'Error',
      status,
      detail: detailFor(exception, status, req),
      instance: req.originalUrl.split('?')[0] ?? req.originalUrl,
      requestId: requestIdOf(req, res),
      ...(exception instanceof ValidationFailedException && { errors: exception.fieldErrors }),
    };

    // 4xx = the client's mistake (the request log line already shows it). 5xx = OUR bug:
    // log the real error with its stack, but never send those details to the client.
    if (status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Request failed');
    }

    res.status(status).type('application/problem+json').json(problem);
  }
}

// The logger gives every request an id (see logging.ts), and the same id is in its log line.
// But a few errors happen BEFORE the logger runs: broken JSON is rejected by the body parser,
// which comes first. Those still get an id, so every error response can be quoted.
const requestIdOf = (req: Request, res: Response): string => {
  if (typeof req.id === 'string' || typeof req.id === 'number') {
    return String(req.id);
  }
  const id = randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  return id;
};

// Stable identifiers for the kinds of problem clients may want to react to differently.
// "about:blank" (the standard's default) = nothing more specific than the HTTP status.
const typeFor = (exception: unknown, status: number): string => {
  if (exception instanceof ValidationFailedException) return '/problems/validation';
  if (status === 429) return '/problems/rate-limited';
  return 'about:blank';
};

const detailFor = (exception: unknown, status: number, req: Request): string => {
  if (!(exception instanceof HttpException)) {
    return 'Something went wrong on our side. Please try again; if it keeps happening, quote the request ID.';
  }
  if (status === 429) {
    return 'Too many requests in a short time. Please wait a moment and try again.';
  }
  const response = exception.getResponse();
  const message = typeof response === 'string' ? response : (response as { message?: unknown }).message;
  // Nest's own 404 for an unknown route says "Cannot GET /api/x": say it in plain words
  if (status === 404 && typeof message === 'string' && message.startsWith('Cannot ')) {
    return `There is no ${req.method} ${req.originalUrl.split('?')[0]} endpoint.`;
  }
  // Nest's body parser reports broken JSON as a 400 with the parser's message
  if (status === 400 && typeof message === 'string' && /JSON/i.test(message)) {
    return 'The request body is not valid JSON.';
  }
  return Array.isArray(message) ? message.join('. ') : typeof message === 'string' ? message : exception.message;
};
