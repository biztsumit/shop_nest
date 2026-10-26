import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss, type Job, type QueueOptions, type SendOptions } from 'pg-boss';
import type { Env } from '../config/env.js';

type Handler<T> = (data: T, job: Job<T>) => Promise<void>;
type Definition = { handler: Handler<never>; options: QueueOptions; cron?: string };

// BACKGROUND JOBS with pg-boss: work that shouldn't make a request wait (sending an email,
// talking to a payment provider) is written as a job into PostgreSQL, and a WORKER picks it up
// a moment later. If it fails, it's retried later with growing gaps ("backoff"). The jobs live
// in the database the app already has: no extra server (like Redis) to run.
//
//   queue.define('email', handler, { retryLimit: 5 })   (a feature module, at startup)
//   await queue.send('email', { to, subject, ... })      (anywhere, during a request)
//   queue.every('orders.expire', '* * * * *', handler)   (a SCHEDULED job: cron syntax)
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly definitions = new Map<string, Definition>();
  private readonly boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.boss = new PgBoss({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      schema: 'pgboss',
      // One connection LISTENs for "a job was created" so workers start at once. Without
      // this, a queue's `notify: true` does nothing and workers only poll.
      useListenNotify: true,
    });
    this.boss.on('error', (err) => this.logger.error({ err }, 'Job queue error'));
  }

  // Called by feature modules when they're created (before the app finishes starting)
  define<T extends object>(name: string, handler: Handler<T>, options: QueueOptions = {}): void {
    this.definitions.set(name, { handler: handler as Handler<never>, options });
  }

  // A job that runs on a timetable. `cron` is the classic five fields:
  //   minute hour day-of-month month day-of-week     "*/5 * * * *" = every 5 minutes
  // pg-boss keeps the timetable in the database, and with several API servers only ONE of them
  // creates each run, so the job never runs twice for the same minute.
  every(name: string, cron: string, handler: () => Promise<void>): void {
    // A scheduled run that fails isn't retried: the next run comes soon anyway
    this.definitions.set(name, { handler, options: { retryLimit: 0 }, cron });
  }

  get schedules(): Array<{ name: string; cron: string }> {
    return [...this.definitions].flatMap(([name, d]) => (d.cron ? [{ name, cron: d.cron }] : []));
  }

  // Every module is ready: start pg-boss, create the queues, start the workers
  onApplicationBootstrap(): Promise<void> {
    this.started ??= this.start();
    return this.started;
  }

  private async start(): Promise<void> {
    await this.boss.start();   // creates the "pgboss" schema and its tables the first time
    const workers = this.config.get('JOBS_ENABLED', { infer: true });
    const schedules = this.config.get('JOB_SCHEDULES_ENABLED', { infer: true });
    for (const [name, { handler, options, cron }] of this.definitions) {
      // notify: the worker is woken the moment a job arrives (LISTEN/NOTIFY), instead of
      // waiting for its next poll
      await this.boss.createQueue(name, { retryLimit: 5, retryDelay: 10, retryBackoff: true, notify: true, ...options } as QueueOptions);
      if (cron) {
        if (schedules) {
          // India time; after downtime (a deploy), run ONCE for what was missed, not once per minute missed
          await this.boss.schedule(name, cron, null, { tz: 'Asia/Kolkata', missed: 'once' });
        } else {
          await this.boss.unschedule(name);
        }
      }
      if (workers) {
        // One job per fetch: a failure retries only that job. Polling stays on as a backstop
        // (a NOTIFY can be missed while the listening connection reconnects).
        await this.boss.work<object>(name, { pollingIntervalSeconds: 2, notifyPollingIntervalSeconds: 5 }, async (jobs) => {
          for (const job of jobs) {
            await handler(job.data as never, job as never);
          }
        });
      }
    }
    this.logger.log({ queues: [...this.definitions.keys()], workers, schedules }, 'Job queue started');
  }

  async send<T extends object>(name: string, data: T, options: SendOptions = {}): Promise<string | null> {
    if (!this.definitions.has(name)) {
      throw new Error(`Unknown job "${name}": define() it first`);
    }
    await (this.started ??= this.start());
    return this.boss.send(name, data, options);
  }

  // On shutdown: stop taking jobs, let running ones finish (up to 10 s), close the connections
  async onApplicationShutdown(): Promise<void> {
    if (this.started) {
      await this.started.catch(() => undefined);
      await this.boss.stop({ graceful: true, timeout: 10_000 });
    }
  }
}
