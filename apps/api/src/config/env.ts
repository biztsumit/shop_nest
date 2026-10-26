import { z } from 'zod';

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
    // How long an access token works. Short: a stolen one is soon useless (3.2 adds refresh)
    ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
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
