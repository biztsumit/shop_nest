import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';

// One job queue for the whole app (@Global: every module can define and send jobs)
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class JobsModule {}
