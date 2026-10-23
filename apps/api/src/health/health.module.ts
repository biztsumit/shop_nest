import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// One feature = one module: its controller(s) and the providers they need
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
