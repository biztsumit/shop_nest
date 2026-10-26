import { execSync } from 'node:child_process';
import { startFakeRazorpay } from './support/fake-razorpay.js';
import { loadTestEnv } from './test-env.js';

// Runs ONCE before all end-to-end tests:
// - brings the test database up to date with every Prisma migration, exactly as a deployment
//   would (migrate deploy never creates new ones)
// - starts the fake Razorpay server that the tests' API talks to
// The function it returns runs once at the very end (teardown).
export default async function setup(): Promise<() => Promise<void>> {
  const env = loadTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, ...env } });

  const razorpay = await startFakeRazorpay();
  return () => new Promise((resolve) => razorpay.close(() => resolve()));
}
