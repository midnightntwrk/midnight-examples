// This file is part of stagenet-q2 (adapted from example-usdcx).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// DUST bootstrap for remote networks. On local/genesis the node gifts NIGHT +
// Dust, so wallets can pay fees immediately. On stagenet/preview/preprod the
// faucet funds NIGHT only — that NIGHT must be REGISTERED for DUST generation
// before the wallet has any DUST to pay transaction fees.
//
// ensureDustRegistered runs the full bootstrap for a single wallet:
//   1. wait until the wallet observes NIGHT UTXOs,
//   2. register any not-yet-registered NIGHT UTXOs for DUST generation,
//   3. wait until available DUST >= minDust.
// It is idempotent: if every NIGHT UTXO is already registered and enough DUST
// is present, it returns immediately.

import type { Logger } from 'pino';

import { PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';

import type { WalletCtx } from './wallet.js';

// Default DUST floor (in Specks) to wait for before running fee-paying txs.
// Anchored to the ledger's initial `nightDustRatio` (5e9 Specks) — the DUST a
// single NIGHT unit yields at full cap. This is comfortably fee-sized: far
// above trivial "some dust started generating" noise, yet a small fraction of
// what any faucet-funded wallet generates, so it's reached quickly. Override
// via `minDust` if your fees or funding differ. (Measured from
// LedgerParameters.initialParameters().dust; re-check if the ledger version
// bumps, as these parameters are network/version-dependent.)
export const DEFAULT_MIN_DUST_SPECKS = 5_000_000_000n;

export interface DustRegisterOptions {
  /** Max time to wait for the faucet-funded NIGHT to appear. Default 15 min. */
  nightTimeoutMs?: number;
  /** Max time to wait for DUST generation to cover the registration fee. Default 15 min. */
  generationTimeoutMs?: number;
  /** Max time to wait for spendable DUST after the registration tx. Default 15 min. */
  dustTimeoutMs?: number;
  /** Minimum available DUST (Specks) to wait for before returning. Default DEFAULT_MIN_DUST_SPECKS. */
  minDust?: bigint;
  /** Poll interval for the NIGHT/DUST wait loops. Default 10s. */
  pollIntervalMs?: number;
}

type NightUtxo = {
  utxo: { value: bigint };
  meta: { registeredForDustGeneration: boolean };
};
// DustFullInfo (@midnightntwrk/wallet-sdk-dust-wallet): `generatedNow` is the
// current spendable Dust in Specks — it charges up over time from the backing
// Night. `token.initialValue` is NOT the live balance; do not sum it.
type DustCoin = { generatedNow: bigint };

const sumNight = (coins: readonly NightUtxo[]) =>
  coins.reduce((a, c) => a + c.utxo.value, 0n);

const sumDust = (coins: readonly DustCoin[]) =>
  coins.reduce((a, c) => a + c.generatedNow, 0n);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure the wallet's NIGHT is registered for DUST generation and has spendable
 * DUST. Safe to call on an already-registered wallet (returns quickly).
 */
export async function ensureDustRegistered(
  ctx: WalletCtx,
  logger: Logger,
  opts: DustRegisterOptions = {},
): Promise<void> {
  const {
    nightTimeoutMs = 15 * 60_000,
    generationTimeoutMs = 15 * 60_000,
    dustTimeoutMs = 15 * 60_000,
    minDust = DEFAULT_MIN_DUST_SPECKS,
    pollIntervalMs = 10_000,
  } = opts;

  const role = ctx.role;
  // The facade methods used below are not on the published WalletFacade type
  // yet; cast to `any` (mirrors scripts/dust-register.mts).
  const facade = ctx.wallet as unknown as {
    waitForSyncedState: () => Promise<{
      unshielded: { availableCoins: readonly NightUtxo[] };
      dust: { availableCoins: readonly DustCoin[] };
    }>;
    estimateRegistration: (u: readonly NightUtxo[]) => Promise<{ fee: bigint }>;
    waitForGeneratedDust: (
      u: readonly NightUtxo[],
      fee: bigint,
      opts: { timeoutMs: number },
    ) => Promise<unknown>;
    registerNightUtxosForDustGeneration: (
      u: readonly NightUtxo[],
      key: unknown,
      sign: (d: Uint8Array) => Promise<unknown>,
    ) => Promise<unknown>;
    finalizeRecipe: (recipe: unknown) => Promise<unknown>;
    submitTransaction: (tx: unknown) => Promise<string>;
  };

  // 1. Wait until the wallet observes faucet-funded NIGHT.
  const nightDeadline = Date.now() + nightTimeoutMs;
  let nightUtxos: readonly NightUtxo[] = [];
  for (;;) {
    const state = await facade.waitForSyncedState();
    nightUtxos = state.unshielded.availableCoins;
    if (nightUtxos.length > 0) break;
    if (Date.now() >= nightDeadline) {
      throw new Error(
        `[${role}] no NIGHT UTXOs after ${nightTimeoutMs}ms — fund the faucet address first`,
      );
    }
    logger.info(`[${role}] waiting for NIGHT to appear...`);
    await sleep(pollIntervalMs);
  }
  logger.info(
    `[${role}] NIGHT balance=${sumNight(nightUtxos)} across ${nightUtxos.length} UTXO(s)`,
  );

  // 2. Register any NIGHT UTXOs not yet generating DUST.
  const unregistered = nightUtxos.filter(
    (u) => !u.meta.registeredForDustGeneration,
  );
  if (unregistered.length === 0) {
    logger.info(`[${role}] all NIGHT UTXOs already registered for DUST`);
  } else {
    const pk = PublicKey.fromKeyStore(ctx.unshieldedKeystore);
    const nightVerifyingKey = pk.publicKey;
    const ks = ctx.unshieldedKeystore as unknown as {
      signDataAsync: (data: Uint8Array) => Promise<unknown>;
    };
    const signSegment = (data: Uint8Array) => ks.signDataAsync(data);

    const { fee } = await facade.estimateRegistration(unregistered);
    logger.info(
      `[${role}] estimated registration fee = ${fee} DUST; waiting for generation...`,
    );
    await facade.waitForGeneratedDust(unregistered, fee, {
      timeoutMs: generationTimeoutMs,
    });

    logger.info(`[${role}] building + submitting registration tx`);
    const recipe = await facade.registerNightUtxosForDustGeneration(
      unregistered,
      nightVerifyingKey,
      signSegment,
    );
    const finalizedTx = await facade.finalizeRecipe(recipe);
    const txId = await facade.submitTransaction(finalizedTx);
    logger.info(`[${role}] registration submitted: tx=${txId}`);
  }

  // 3. Wait until spendable DUST >= minDust.
  const dustDeadline = Date.now() + dustTimeoutMs;
  for (;;) {
    const state = await facade.waitForSyncedState();
    const dust = state.dust.availableCoins;
    const registered = state.unshielded.availableCoins.filter(
      (u) => u.meta.registeredForDustGeneration,
    ).length;
    const dustTotal = sumDust(dust);
    logger.info(
      `[${role}] registeredUtxos=${registered} dustCoins=${dust.length} generatedNow=${dustTotal} Specks`,
    );
    if (dustTotal >= minDust) {
      logger.info(`[${role}] DUST ready (${dustTotal} >= ${minDust} Specks) ✅`);
      return;
    }
    if (Date.now() >= dustDeadline) {
      throw new Error(
        `[${role}] DUST did not reach ${minDust} Specks within ${dustTimeoutMs}ms (have ${dustTotal})`,
      );
    }
    await sleep(pollIntervalMs);
  }
}
