import { defineConfig } from 'vitest/config';

// Aggregate config so `vitest` can be run from the repo root across every
// example. Each example still owns its own vitest.config.ts (network/env
// handling); this just registers them as projects. Note that the primary
// path in CI is `npm run test --workspaces`, which runs each example
// in its own process against its own local Midnight network.
export default defineConfig({
  test: {
    projects: ['examples/*'],
  },
});
