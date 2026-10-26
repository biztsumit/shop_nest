import { Global, Module } from '@nestjs/common';
import { EmailQueue } from './email-queue.js';
import { EmailService } from './email.service.js';

@Global()
@Module({
  providers: [EmailService, EmailQueue],
  exports: [EmailService, EmailQueue],
})
export class EmailModule {}
