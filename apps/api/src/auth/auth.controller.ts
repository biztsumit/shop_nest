import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, registerSchema, type AuthResponse, type Login, type Register, type User } from '@shop/shared';
import { AccessTokenGuard } from './access-token.guard.js';
import type { AuthUser } from './auth-user.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';

// Stricter than the app-wide limit: 10 attempts a minute per IP address is plenty for a person,
// and makes guessing passwords (or mass sign-ups) slow
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /api/auth/register  { name, email, password }
  @Post('register')
  @Throttle(STRICT)
  register(@Body({ schema: registerSchema }) body: Register): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  // POST /api/auth/login  { email, password }
  // 200, not 201: logging in doesn't create a resource
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  login(@Body({ schema: loginSchema }) body: Login): Promise<AuthResponse> {
    return this.auth.login(body);
  }

  // GET /api/auth/me  (Authorization: Bearer <access token>)
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user.id);
  }
}
