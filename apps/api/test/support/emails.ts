import type { INestApplication } from '@nestjs/common';
import { EmailService, type EmailMessage } from '../../src/email/email.service.js';

// Emails are queued and sent by a background worker, a moment after the request. Tests wait
// for them to appear in the in-memory outbox (EMAIL_TRANSPORT=memory: nothing is really sent).
export const waitForEmail = async (
  app: INestApplication,
  match: (message: EmailMessage) => boolean,
  timeoutMs = 4_000,   // under the 5 s test timeout, so a missing email fails with this message
): Promise<EmailMessage> => {
  const outbox = app.get(EmailService).outbox;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = outbox.find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No matching email within ${timeoutMs} ms. Outbox: ${outbox.map((m) => `${m.to}: ${m.subject}`).join(' | ') || 'empty'}`);
};

// The token from a link like https://shop/verify-email?token=abc
export const tokenFrom = (message: EmailMessage): string => {
  const token = /[?&]token=([\w-]+)/.exec(message.text)?.[1];
  if (!token) throw new Error(`No token link in "${message.subject}"`);
  return token;
};

export const clearOutbox = (app: INestApplication): void => {
  app.get(EmailService).outbox.length = 0;
};
