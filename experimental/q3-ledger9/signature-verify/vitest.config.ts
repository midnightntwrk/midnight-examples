import { defineConfig } from 'vitest/config';

// Two layers (q3-testing-strategy.md "Testing posture"):
//   sim  L1 — in memory: pure circuits and the compact-runtime simulator.
//             No network, no proving keys. Seconds.
//   e2e  L2 — deploy and call on the local ledger 9 network from ../compose.yml,
//             with real proofs. Minutes.
export default defineConfig({
  test: {
    environment: 'node',
    disableConsoleIntercept: true,
    projects: [
      { extends: true, test: { name: 'sim', include: ['src/test/**/*.sim.test.ts'], testTimeout: 120_000 } },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['src/test/**/*.e2e.test.ts'],
          testTimeout: 15 * 60_000,
          hookTimeout: 20 * 60_000,
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
