import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// @if monorepo
// Remote runs read their wallet seeds from a single repo-root .env.<network>,
// so one set of funded wallets serves every example. Shell env still wins over
// file values. Generate the file with `yarn wallets:new` from the repo root.
const envDir = fileURLToPath(new URL('../../', import.meta.url));
// @endif
// @if standalone
// Remote runs read their wallet seeds from .env.<network> next to this file
// (gitignored). Shell env still wins over file values.
const envDir = fileURLToPath(new URL('./', import.meta.url));
// @endif
const envFromFile = isRemote ? loadEnv(network, envDir, '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: envFromFile,
    testTimeout: 10 * 60_000,
    // A remote wallet build plus the faucet funding gate needs far longer than
    // a local devnet's beforeAll.
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
