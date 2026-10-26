import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { AccessTokenPayload } from './auth-user.js';
import { ACCESS_AUDIENCE, TOKEN_ISSUER } from './tokens.js';

// A GUARD runs before the route handler and decides if the request may continue.
// This one requires "Authorization: Bearer <access token>": a token this API signed, not yet
// expired, and of the right kind (audience). Then it records who the user is on the request.
//
// Use it on a route or a whole controller: @UseGuards(AccessTokenGuard)
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];

    if (!token) {
      throw this.unauthorized(context, 'Please log in first.');
    }
    try {
      // Checks the signature (made with OUR secret), the expiry, the issuer and the audience
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        issuer: TOKEN_ISSUER,
        audience: ACCESS_AUDIENCE,
      });
      req.user = { id: payload.sub, role: payload.role };
      return true;
    } catch {
      // Expired, tampered with, signed with another secret, or another kind of token: to the
      // client it's all the same, "log in again". (The exact reason isn't given to attackers.)
      throw this.unauthorized(context, 'Your session has ended. Please log in again.');
    }
  }

  // 401 + the standard header saying which kind of credentials this API expects
  private unauthorized(context: ExecutionContext, message: string): UnauthorizedException {
    context.switchToHttp().getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
    return new UnauthorizedException(message);
  }
}
