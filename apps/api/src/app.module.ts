import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loggingModule } from './common/logging.js';
import { validateEnv, type Env } from './config/env.js';
import { AddressesModule } from './addresses/addresses.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CartModule } from './cart/cart.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { EmailModule } from './email/email.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { UsersModule } from './users/users.module.js';
import { WishlistModule } from './wishlist/wishlist.module.js';

// The root module: the app is the tree of modules imported from here
@Module({
  imports: [
    // Reads .env (.env.test when testing: Vitest sets NODE_ENV=test), checks it with validateEnv
    // (the app won't start with bad settings), and makes ConfigService available everywhere.
    // Real environment variables win over the file, which is how CI and hosting pass settings.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      validate: validateEnv,
    }),
    loggingModule,
    // Rate limiting: at most RATE_LIMIT_PER_MINUTE requests per minute from one IP address.
    // Stricter limits for sensitive routes (login...) come with those routes.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { ttl: 60_000, limit: config.get('RATE_LIMIT_PER_MINUTE', { infer: true }) },
      ],
    }),
    PrismaModule,
    JobsModule,
    EmailModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    UsersModule,
    CartModule,
    AddressesModule,
    OrdersModule,
    WishlistModule,
    ReviewsModule,
    PaymentsModule,
    MaintenanceModule,
    AdminModule,
  ],
  providers: [
    // A GUARD decides whether a request may continue at all. APP_GUARD makes this one apply to
    // every route; a route can opt out with @SkipThrottle()
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
