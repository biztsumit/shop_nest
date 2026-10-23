import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

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
  return env;
};

const pickDefined = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
