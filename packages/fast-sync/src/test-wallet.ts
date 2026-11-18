// Get-or-create a persistent fresh wallet for a remote network. Persisting it
// means a developer funds the wallet once at the faucet rather than on every
// run.
//
// The seed is a secret; the store lives in a gitignored directory.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PersistedWallet {
  seed: string;
  createdAt: string;
}

export function getOrCreateTestWallet(
  dir: string,
  networkId: string,
): { wallet: PersistedWallet; isNew: boolean } {
  const file = join(dir, `${networkId}.json`);
  if (existsSync(file)) {
    return { wallet: JSON.parse(readFileSync(file, 'utf8')) as PersistedWallet, isNew: false };
  }
  const wallet: PersistedWallet = {
    seed: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return { wallet, isNew: true };
}
