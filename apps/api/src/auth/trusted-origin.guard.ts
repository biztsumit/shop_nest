import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';

// A second wall against CSRF, for the endpoints that act on the login cookie.
// Browsers add an Origin header to every POST ("which website is asking"). If it's another
// website, refuse. No Origin at all means the request didn't come from a browser page (a
// script, curl), and only browsers can be tricked into sending your cookies, so that's allowed.
@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin !== undefined && origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('This request came from another website, so it was refused.');
    }
    return true;
  }
}
