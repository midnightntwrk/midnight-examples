// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Small per-suite wallet helpers layered over wallet.ts + secret.ts. A funded
// wallet is a full facade (create + sync + DUST-register on remote) for a role
// that submits transactions; an address-only participant is just a 32-byte
// address derived from a seed, for a role that never pays (a transfer
// recipient, an LP, a fee account).

import type { Logger } from 'pino';

import type { NetworkConfig } from './config.js';
import { ensureDustRegistered } from './dust.js';
import { IS_REMOTE, resolveSecret } from './secret.js';
import { createWallet, deriveAddress, syncWallet, type WalletCtx } from './wallet.js';

/** Create, sync, and (on remote networks) DUST-register a funded submitter wallet. */
export async function startFundedWallet(
  role: string,
  localIndex: number,
  config: NetworkConfig,
  logger: Logger,
  syncTimeoutMs: number,
): Promise<WalletCtx> {
  const ctx = await createWallet(role, resolveSecret(role, localIndex), config, logger);
  await syncWallet(ctx, logger, syncTimeoutMs);
  // On remote networks the faucet funds NIGHT only; register it for DUST so the
  // wallet can pay fees. Idempotent, and skipped on the genesis-gifted devnet.
  if (IS_REMOTE) await ensureDustRegistered(ctx, logger);
  return ctx;
}

/** Derive the 32-byte address for a role that never submits a tx (no funding). */
export function participantAddress(
  role: string,
  localIndex: number,
  config: NetworkConfig,
): Uint8Array {
  return deriveAddress(resolveSecret(role, localIndex), config.networkId);
}
