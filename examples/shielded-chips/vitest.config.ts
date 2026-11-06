import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// Remote runs read their wallet seeds from a single repo-root .env.<network>,
// so one set of funded wallets serves every example. Shell env still wins over
// file values. Generate the file with `npm run wallets:new` from the repo root.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
// MIDNIGHT_ENV_FILE names one more env file (relative to the repo root), read
// after .env.<network>, so its values win over that file's. It lets one network
// switch endpoint sets without editing code, e.g. .env.custom.prefork and
// .env.custom.postfork on top of the seeds in .env.custom.
const envFile = process.env['MIDNIGHT_ENV_FILE'];
function readEnvFile(name: string): Record<string, string> {
  const file = resolve(repoRoot, name);
  if (!existsSync(file)) throw new Error(`MIDNIGHT_ENV_FILE=${name}, but ${file} does not exist.`);
  const parsed = parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => process.env[key] === undefined));
}
const envFromFile = isRemote
  ? { ...loadEnv(network, repoRoot, ''), ...(envFile ? readEnvFile(envFile) : {}) }
  : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: envFromFile,
    // Several tests mint, sync three wallets, and prove multiple circuits.
    testTimeout: 15 * 60_000,
    // A remote wallet build plus the faucet funding gate needs far longer than
    // a local devnet's beforeAll.
    hookTimeout: isRemote ? 150 * 60_000 : 15 * 60_000,
    include: ['src/**/*.test.ts'],
    // roulette.test.ts and privacy.test.ts share the same Alice/Bob wallets.
    // Vitest runs test files in parallel by default, and concurrent spends of
    // the same UTXOs produce nondeterministic balancing failures.
    fileParallelism: false,
    reporters: ['default'],
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
