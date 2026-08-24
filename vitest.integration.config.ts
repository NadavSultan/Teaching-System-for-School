import { defineConfig } from 'vitest/config';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests; database tests may not be skipped.',
  );
}

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
