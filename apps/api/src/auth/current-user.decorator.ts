import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.js';

// A custom PARAMETER DECORATOR: `me(@CurrentUser() user: AuthUser)` hands the handler the
// logged-in user that AccessTokenGuard put on the request. Handlers never dig into `req`.
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<Request>().user;
  if (!user) {
    // Only happens if a route uses @CurrentUser() without AccessTokenGuard: our bug, not the client's
    throw new InternalServerErrorException('@CurrentUser() used on a route without AccessTokenGuard');
  }
  return user;
});
