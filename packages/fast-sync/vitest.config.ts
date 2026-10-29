import { defineConfig } from 'vitest/config';

// Own config so vitest doesn't pick up the repo-root aggregate (examples/* only).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
