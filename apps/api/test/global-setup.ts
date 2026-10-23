import { execSync } from 'node:child_process';
import { loadTestEnv } from './test-env.js';

// Runs ONCE before all end-to-end tests: brings the test database up to date with every
// Prisma migration, exactly as a deployment would (migrate deploy never creates new ones)
export default function setup(): void {
  const env = loadTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, ...env } });
}
