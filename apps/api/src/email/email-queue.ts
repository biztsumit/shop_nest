import { Injectable } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service.js';
import { EmailService, type EmailMessage } from './email.service.js';

const QUEUE = 'email';

// How the rest of the app sends email: it's QUEUED, not sent during the request. The request
// stays fast, and if the email provider is down the job is retried (5 times, waiting longer
// each time) instead of the user seeing an error.
@Injectable()
export class EmailQueue {
  constructor(
    private readonly queue: QueueService,
    email: EmailService,
  ) {
    // The worker: takes a queued email and really sends it. A throw = retry later.
    queue.define<EmailMessage>(QUEUE, (message) => email.send(message), {
      // Emails carry one-time links: don't keep them around long after they're sent
      deleteAfterSeconds: 24 * 60 * 60,
    });
  }

  enqueue(message: EmailMessage): Promise<string | null> {
    return this.queue.send(QUEUE, message);
  }
}
