import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The test database settings, given to every test (and checked to really be a test database)
    env: loadTestEnv(),
    // Migrate the test database first
    globalSetup: ['./test/global-setup.ts'],
    // One file at a time: they share one database
    fileParallelism: false,
  },
});
