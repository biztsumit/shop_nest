import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

@Module({
  imports: [
    // registerAsync: the secret comes from the validated settings, read when the app starts
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        // Only this algorithm is accepted when verifying: a token claiming "alg: none" (no
        // signature at all) or another algorithm is refused
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshTokensService, AccessTokenGuard, TrustedOriginGuard],
  // Other modules protect their routes with the guard, so it (and the JWT service it needs) is shared
  exports: [AccessTokenGuard, JwtModule],
})
export class AuthModule {}
