import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// For remote networks, source secrets (e.g. MIDNIGHT_STAGENET_DEPLOYER_SEED)
// from .env.<network> so they don't need to be passed on the command line.
// Shell env still wins over file values.
const envFromFile = isRemote ? loadEnv(network, process.cwd(), '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10 * 60_000,
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    env: envFromFile,
    include: ['src/test/**/*.test.ts'],
    reporters: ['default'],
    // One dapp at a time: each suite drives shared wallets + a local proof
    // server, and concurrent proving/balancing across suites contends for the
    // same funded DUST and the single proof server.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
