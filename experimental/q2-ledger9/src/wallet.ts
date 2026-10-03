// This file is part of stagenet-q2 (adapted from example-usdcx).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from 'node:buffer';

import * as Rx from 'rxjs';
import { mnemonicToSeedSync } from '@scure/bip39';

import * as ledger from '@midnightntwrk/ledger-v9';
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';

import type { Logger } from 'pino';

import type { NetworkConfig } from './config.js';

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };

export interface WalletCtx {
  readonly role: string;
  readonly wallet: WalletFacade;
  readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly unshieldedKeystore: ReturnType<typeof createKeystore>;
}

// Same shape as the wallet facade's txHistoryStorage: no-ops so the facade
// starts without a persistent history store. The dapp reads state directly.
const noopTxHistoryStorage = {
  gotPending: async () => undefined,
  gotFinalized: async () => undefined,
  gotRejected: async () => undefined,
  getAll: async () => [] as unknown[],
  get: async () => undefined,
  serialize: async () => '',
};

function secretToSeed(secret: WalletSecret): Uint8Array {
  if (secret.kind === 'seed') {
    const hex = secret.value.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error(
        'seed must be a hex string of even length (with or without 0x prefix)',
      );
    }
    return new Uint8Array(Buffer.from(hex, 'hex'));
  }
  // BIP-39: 24-word mnemonic → 64-byte seed. HDWallet.fromSeed accepts any
  // seed length (it feeds into BIP-32 HMAC-SHA512), so passing the full 64
  // bytes is correct — do NOT truncate.
  return mnemonicToSeedSync(secret.value.trim().replace(/\s+/g, ' '));
}

function deriveKeys(seed: Uint8Array) {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') {
    throw new Error(`invalid seed: ${JSON.stringify(hd)}`);
  }
  const result = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') {
    throw new Error(`key derivation failed: ${JSON.stringify(result)}`);
  }
  hd.hdWallet.clear();
  return result.keys;
}

export async function createWallet(
  role: string,
  secret: WalletSecret,
  config: NetworkConfig,
  logger: Logger,
): Promise<WalletCtx> {
  const seed = secretToSeed(secret);
  const keys = deriveKeys(seed);

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: keys[Roles.NightExternal] },
    config.networkId,
  );

  const feeBlocksMargin = Number(process.env['FEE_BLOCKS_MARGIN'] ?? '100');

  const configuration = {
    networkId: config.networkId,
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    provingServerUrl: new URL(config.proofServer),
    // The wallet SDK's relay URL is the node's WebSocket endpoint.
    relayURL: new URL(config.nodeWS),
    costParameters: { feeBlocksMargin },
    txHistoryStorage: noopTxHistoryStorage,
  };

  const wallet: WalletFacade = await (
    WalletFacade as never as { init: (opts: unknown) => Promise<WalletFacade> }
  ).init({
    configuration,
    shielded: (cfg: unknown) =>
      ShieldedWallet(cfg as never).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: unknown) =>
      UnshieldedWallet(cfg as never).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: (cfg: unknown) =>
      DustWallet(cfg as never).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  logger.info(`wallet[${role}]: started (network=${config.networkId})`);
  return { role, wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

export async function syncWallet(
  ctx: WalletCtx,
  logger: Logger,
  timeoutMs: number,
): Promise<void> {
  logger.info(`wallet[${ctx.role}]: syncing (timeout ${timeoutMs}ms)`);
  // throttleTime is load-bearing, not cosmetic: isSynced flaps true→false→true
  // early in sync (synced to a young chain, then re-syncing as blocks land).
  // Sampling every 5s waits for a STABLE synced state — by which point the
  // genesis dust UTXO is finalized + spendable, so the first deploy can pay
  // fees. Dropping it lets firstValueFrom grab the premature transient true
  // and the next tx fails with "could not balance dust".
  let emissions = 0;
  await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.tap(() => {
        emissions++;
      }),
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced === true),
      Rx.timeout({
        first: timeoutMs,
        with: () =>
          Rx.throwError(
            () =>
              new Error(
                `wallet[${ctx.role}]: sync timeout after ${timeoutMs}ms (${emissions} state emissions)`,
              ),
          ),
      }),
    ),
  );
  logger.info(`wallet[${ctx.role}]: synced (${emissions} state emissions)`);
}

export async function stopWallet(ctx: WalletCtx, logger: Logger): Promise<void> {
  logger.info(`wallet[${ctx.role}]: stopping`);
  try {
    await ctx.wallet.stop();
  } catch (err) {
    logger.warn(`wallet[${ctx.role}]: stop() failed: ${String(err)}`);
  }
}

/** 32-byte unshielded user address — the value contracts see when this wallet calls a circuit. */
export function addressBytes(ctx: WalletCtx): Uint8Array {
  return ledger.encodeUserAddress(ctx.unshieldedKeystore.getAddress());
}

/**
 * Derive just the 32-byte unshielded address for a seed/mnemonic — no wallet,
 * no network. For address-only participants (a transfer recipient, an LP, a
 * fee account) that never submit a transaction and so need no funding.
 */
export function deriveAddress(secret: WalletSecret, networkId: string): Uint8Array {
  const keys = deriveKeys(secretToSeed(secret));
  const keystore = createKeystore({ kind: 'schnorr', secret: keys[Roles.NightExternal] }, networkId);
  return ledger.encodeUserAddress(keystore.getAddress());
}
