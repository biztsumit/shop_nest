import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Env } from '../config/env.js';
import { MetricsService } from '../metrics/metrics.service.js';

export type EmailMessage = { to: string; subject: string; html: string; text: string };

// Sends one email, the way EMAIL_TRANSPORT says:
// - log: writes it to apps/api/.emails/ (open the .html in a browser) and logs a line
// - memory: keeps it in `outbox`, for tests to read; nothing is sent
// - brevo: really sends it, through Brevo's HTTP API
//
// Nothing calls this directly from a request: emails are QUEUED (EmailQueue) and a background
// worker calls send(), with retries if the email service is down.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  readonly outbox: EmailMessage[] = [];

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {}

  // Counted either way (shop_emails_total{result="sent|failed"}): a rising "failed" line is the
  // first sign the email provider is down or the API key was revoked
  async send(message: EmailMessage): Promise<void> {
    try {
      await this.deliver(message);
      this.metrics.emails.inc({ result: 'sent' });
    } catch (err) {
      this.metrics.emails.inc({ result: 'failed' });
      throw err;
    }
  }

  private async deliver(message: EmailMessage): Promise<void> {
    // `||`, not `??`: an empty "EMAIL_REDIRECT_TO=" line means "not set", never "send to nobody".
    // (Validation turns '' into undefined, but ConfigService then falls back to the raw
    // process.env value, which is still ''.)
    const redirect = this.config.get('EMAIL_REDIRECT_TO', { infer: true }) || undefined;
    // The safety net: while developing with a real provider, every email goes to one inbox
    const to = redirect ?? message.to;
    const subject = redirect ? `[for ${message.to}] ${message.subject}` : message.subject;

    switch (this.config.get('EMAIL_TRANSPORT', { infer: true })) {
      case 'memory':
        this.outbox.push({ ...message, to, subject });
        return;
      case 'log':
        return this.writeToFolder({ ...message, to, subject });
      case 'brevo':
        return this.sendWithBrevo({ ...message, to, subject });
    }
  }

  private async writeToFolder(message: EmailMessage): Promise<void> {
    await mkdir('.emails', { recursive: true });
    const file = `.emails/${new Date().toISOString().replace(/[:.]/g, '-')}-${message.to.replace(/[^\w.@-]/g, '_')}.html`;
    await writeFile(file, `<!-- To: ${message.to} | Subject: ${message.subject} -->\n${message.html}`);
    this.logger.log({ to: message.to, subject: message.subject, file }, 'Email written (EMAIL_TRANSPORT=log)');
  }

  private async sendWithBrevo(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.config.get('BREVO_API_KEY', { infer: true }) ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: this.config.get('EMAIL_FROM_ADDRESS', { infer: true }), name: this.config.get('EMAIL_FROM_NAME', { infer: true }) },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Thrown, so the job fails and the queue retries it later
      throw new Error(`Brevo answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}
