import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 10 * 60_000,
    hookTimeout: 15 * 60_000,
    include: ['src/**/*.test.ts'],
    sequence: { concurrent: false },
    fileParallelism: false,
    disableConsoleIntercept: true,
  },
});
