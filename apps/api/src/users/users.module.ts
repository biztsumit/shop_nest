import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { UsersService } from './users.service.js';

// AuthModule is imported for its guards (AccessTokenGuard and RolesGuard)
@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
