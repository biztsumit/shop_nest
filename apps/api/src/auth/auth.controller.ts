import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, registerSchema, type AuthResponse, type Login, type Register, type User } from '@shop/shared';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { Auth } from './auth.decorator.js';
import type { AuthUser } from './auth-user.js';
import { AuthService, type Session } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { SESSION_ENDED } from './refresh-tokens.service.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

// Stricter than the app-wide limit: 10 attempts a minute per IP address is plenty for a person,
// and makes guessing passwords (or mass sign-ups) slow
const STRICT = { default: { limit: 10, ttl: 60_000 } };

// Every route here reads or writes the login cookie: refuse requests started by other websites
@UseGuards(TrustedOriginGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // Cookies marked "secure" are only sent over HTTPS: on in production, off for http://localhost
  private get secureCookies(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  // @Res({ passthrough: true }): we set a cookie on the response, and Nest still sends the
  // returned object as the JSON body
  private send({ response, refresh }: Session, res: Response): AuthResponse {
    setRefreshCookie(res, refresh.token, refresh.expiresAt, this.secureCookies);
    return response;
  }

  // POST /api/auth/register  { name, email, password }
  @Post('register')
  @Throttle(STRICT)
  async register(@Body({ schema: registerSchema }) body: Register, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    return this.send(await this.auth.register(body), res);
  }

  // POST /api/auth/login  { email, password }
  // 200, not 201: logging in doesn't create a resource
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  async login(@Body({ schema: loginSchema }) body: Login, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    return this.send(await this.auth.login(body), res);
  }

  // POST /api/auth/refresh  (no body: the refresh token comes from the httpOnly cookie)
  // The web app calls this when its access token has expired, and on page load
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const token = readRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    try {
      return this.send(await this.auth.refresh(token), res);
    } catch (err) {
      // An ended session: also remove the dead cookie from the browser (a 409 "retry" keeps it)
      if (err instanceof UnauthorizedException) {
        clearRefreshCookie(res, this.secureCookies);
      }
      throw err;
    }
  }

  // POST /api/auth/logout: ends this device's login. Works (204) even if already logged out.
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.secureCookies);
  }

  // POST /api/auth/logout-all: "I lost my phone": ends every login, on every device.
  // Needs the access token, so a stolen-and-replayed cookie alone can't trigger it.
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth()
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutEverywhere(user.id);
    clearRefreshCookie(res, this.secureCookies);
  }

  // GET /api/auth/me  (Authorization: Bearer <access token>)
  @Get('me')
  @Auth()
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user.id);
  }
}
