import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

// Global: every module that changes things on an admin's behalf records them here
@Global()
@Module({
  imports: [AuthModule],   // for its guards
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
