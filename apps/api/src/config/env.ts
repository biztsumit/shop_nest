import { z } from 'zod';

// Every setting the API reads from the environment, checked ONCE at startup.
// A missing or malformed value stops the app immediately with a clear message, instead of
// failing later in some request (the same idea as src/config/env.ts in node-learning).
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
  // The web app's address: the only browser origin allowed to call this API (CORS)
  WEB_ORIGIN: z.url().default('http://localhost:4100'),
});

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
