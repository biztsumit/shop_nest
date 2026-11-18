import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { FAKE_KEY_ID, FAKE_KEY_SECRET, FAKE_RAZORPAY_PORT, FAKE_WEBHOOK_SECRET } from './support/fake-razorpay.js';

export const CLOUDINARY_TEST_SECRET = 'test-only-cloudinary-secret';
export const TEST_SELLER = { legalName: 'Shop Nest Test Private Limited', gstin: '29ABCDE1234F1ZW', address: '12 MG Road, Bengaluru 560001' };

// The settings end-to-end tests run with.
// - On a developer machine: apps/api/.env.test (git-ignored), which points at a SEPARATE
//   database, so tests never touch the data you click around in.
// - In CI: there's no .env.test; the workflow passes DATABASE_URL itself.
export const loadTestEnv = (): Record<string, string> => {
  const fromFile = existsSync('.env.test') ? parse(readFileSync('.env.test')) : {};
  const env = { ...fromFile, ...pickDefined(process.env) };

  // Tests create and delete data freely. Refuse anything that isn't clearly a test database.
  const database = env.DATABASE_URL ? new URL(env.DATABASE_URL).pathname.slice(1) : '';
  if (!database.endsWith('_test')) {
    throw new Error(
      `E2E tests need a test database (name ending in _test), got "${database || 'none'}". ` +
        'Create apps/api/.env.test with DATABASE_URL=.../shop_nest_test (see .env.example).',
    );
  }
  // Tests NEVER send real email or touch real payments, whatever .env.test or the shell says:
  // emails are kept in memory (where tests read their links), and payments go to the fake
  // Razorpay server that global-setup.ts starts
  return {
    ...env,
    EMAIL_TRANSPORT: 'memory',
    EMAIL_REDIRECT_TO: '',
    // Tests run the scheduled jobs' functions themselves, at the moments they choose
    JOB_SCHEDULES_ENABLED: 'false',
    // /api/metrics is tested with this throwaway token
    METRICS_TOKEN: 'test-only-metrics-token-0123456789',
    RAZORPAY_KEY_ID: FAKE_KEY_ID,
    RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    RAZORPAY_API_URL: `http://127.0.0.1:${FAKE_RAZORPAY_PORT}`,
    // Made-up Cloudinary keys: tests check the signatures; nothing is ever uploaded
    CLOUDINARY_CLOUD_NAME: 'shop-test',
    CLOUDINARY_API_KEY: '123456789012345',
    CLOUDINARY_API_SECRET: CLOUDINARY_TEST_SECRET,
    // A made-up seller in Karnataka (state code 29) for the GST invoices; the GSTIN only has to be
    // well-formed (its check character is right)
    SHOP_LEGAL_NAME: TEST_SELLER.legalName,
    SHOP_GSTIN: TEST_SELLER.gstin,
    SHOP_ADDRESS: TEST_SELLER.address,
  };
};

const pickDefined = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
