import { z } from 'zod';

// "KEY=" (an empty line in .env) means "not set"
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

// Every setting the API reads from the environment, checked ONCE at startup.
// A missing or malformed value stops the app immediately with a clear message, instead of
// failing later in some request (the same idea as src/config/env.ts in node-learning).
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
    // The web app's address: the only browser origin allowed to call this API (CORS)
    WEB_ORIGIN: z.url().default('http://localhost:4100'),
    // Signs the login tokens: whoever knows it can make tokens for ANY user. Long and random
    // (node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"), never committed.
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters (a short secret can be guessed)'),
    // How long an access token works. Short: a stolen one is soon useless
    ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    // How long you stay logged in without visiting. Every refresh starts the count again.
    REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // How much the API logs. Left out: "info", or "silent" while testing
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    // Requests per minute from one client (by IP address) before it gets 429 Too Many Requests
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    // Which proxies may tell us the client's real IP (X-Forwarded-For). Requests reach the API
    // through the Next.js server, so without this EVERY shopper would look like that one
    // server and share one rate limit. "loopback" = only proxies on this same machine.
    // A number (e.g. 1) = trust that many proxy hops, the usual setting behind a host's load balancer.
    TRUST_PROXY: z
      .string()
      .default('loopback')
      .transform((value) => (/^\d+$/.test(value) ? Number(value) : value)),

    // ---------- Email ----------
    // log: written to apps/api/.emails/*.html (development) · memory: kept for tests to read,
    // never sent · brevo: really sent, through Brevo's HTTP API
    EMAIL_TRANSPORT: z.enum(['log', 'memory', 'brevo']).default('log'),
    BREVO_API_KEY: z.string().optional(),
    EMAIL_FROM_ADDRESS: z.email().default('shop@example.com'),
    EMAIL_FROM_NAME: z.string().min(1).default('Shop'),
    // Send EVERY email to this one address instead (a safety net while developing with brevo)
    EMAIL_REDIRECT_TO: z.preprocess((v) => (v === '' ? undefined : v), z.email().optional()),

    // ---------- Background jobs ----------
    // Run the job WORKERS in this process. Jobs can always be queued; with several API servers
    // (or a separate worker process) you can choose which ones do the work.
    JOBS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

    // ---------- Orders ----------
    // How long an unpaid order holds its stock before it expires and the stock goes back on sale
    ORDER_PAYMENT_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),

    // ---------- Payments (Razorpay) ----------
    // From the Razorpay Dashboard → Account & Settings → API Keys. Test keys (rzp_test_...) take
    // pretend payments. Without keys the shop still works, but orders can't be paid online.
    RAZORPAY_KEY_ID: z.preprocess(emptyToUndefined, z.string().regex(/^rzp_(test|live)_\w+$/, 'must look like rzp_test_... or rzp_live_...').optional()),
    RAZORPAY_KEY_SECRET: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
    // Set when creating the webhook in the Dashboard (Settings → Webhooks); signs every event
    RAZORPAY_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
    // Only changed by tests, which point it at a fake Razorpay server
    RAZORPAY_API_URL: z.url().default('https://api.razorpay.com'),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['BREVO_API_KEY'], message: 'is required when EMAIL_TRANSPORT=brevo' });
    }
    // Both keys or neither: one without the other is always a mistake
    if (Boolean(env.RAZORPAY_KEY_ID) !== Boolean(env.RAZORPAY_KEY_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_SECRET'], message: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET go together: set both or neither' });
    }
  })
  .transform((env) => ({ ...env, LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info') }));

export type Env = z.infer<typeof envSchema>;

// ConfigModule calls this with the raw environment; what it returns becomes the config
export const validateEnv = (raw: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid or missing settings in .env:\n${problems.join('\n')}`);
  }
  return result.data;
};
