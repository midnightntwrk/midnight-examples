// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Per-role secret resolution, generalized from example-usdcx's usdcx.test.ts.
// On `local` every role uses a genesis-gifted devnet seed. On remote networks
// each role's secret is read from MIDNIGHT_<NETWORK>_<ROLE>_{SEED,MNEMONIC}
// (typically sourced from .env.<network>; see vitest.config.ts).

import type { WalletSecret } from './wallet.js';

export const NETWORK = process.env['MIDNIGHT_NETWORK'] ?? 'local';
export const IS_REMOTE = NETWORK !== 'local';

// Local devnet genesis seeds — the `undeployed` chainspec (CFG_PRESET=dev)
// gifts each of these NIGHT + Zswap + Dust at genesis. Enough distinct seeds
// for every role any dapp uses; extend if a dapp needs more than four.
const LOCAL_GENESIS_SEEDS = [
  '0000000000000000000000000000000000000000000000000000000000000001',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000000003',
  'a51c86de32d0791f7cffc3bdff1abd9bb54987f0ed5effc30c936dddbb9afd9d530c8db445e4f2d3ea42a321b260e022aadf05987c9a67ec7b6b6ca1d0593ec9',
] as const;

/**
 * Resolve one role's wallet secret. On remote networks reads
 * MIDNIGHT_<NETWORK>_<ROLE>_SEED or _MNEMONIC (exactly one). On `local`,
 * `localIndex` selects which genesis seed backs the role (roles must pass
 * distinct indices to get distinct devnet wallets).
 */
export function resolveSecret(role: string, localIndex: number): WalletSecret {
  if (!IS_REMOTE) {
    const seed = LOCAL_GENESIS_SEEDS[localIndex];
    if (!seed) {
      throw new Error(
        `local role "${role}" wants genesis seed #${localIndex} but only ${LOCAL_GENESIS_SEEDS.length} exist`,
      );
    }
    return { kind: 'seed', value: seed };
  }

  const upperNet = NETWORK.toUpperCase();
  const upperRole = role.toUpperCase();
  const mnemonicEnv = `MIDNIGHT_${upperNet}_${upperRole}_MNEMONIC`;
  const seedEnv = `MIDNIGHT_${upperNet}_${upperRole}_SEED`;
  const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
  const seedHex = process.env[seedEnv]?.trim();

  if (mnemonic && seedHex) {
    throw new Error(`Set only one of ${mnemonicEnv} or ${seedEnv} (both are defined).`);
  }
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic };
  if (seedHex) return { kind: 'seed', value: seedHex };
  throw new Error(
    `Either ${mnemonicEnv} or ${seedEnv} is required for network '${NETWORK}'. ` +
      `Set one in .env.${NETWORK} or the shell.`,
  );
}
