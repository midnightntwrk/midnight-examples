// The test wallet, built from the published Midnight SDK packages only:
// @midnight-ntwrk/testkit-js supplies the wallet provider and sync helper, and
// @midnight-ntwrk/wallet-sdk the wallet itself.
//
// A wallet syncs from genesis. On a local devnet that takes seconds; on preprod
// it can take over an hour the first time, so remote runs set a long
// MIDNIGHT_SYNC_TIMEOUT_MS (see the test suite).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DustSecretKey, unshieldedToken, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  MidnightWalletProvider,
  syncWallet as testkitSyncWallet,
} from '@midnight-ntwrk/testkit-js';
import type { FacadeState, UnshieldedKeystore, WalletFacade } from '@midnight-ntwrk/wallet-sdk';
import type { Logger } from 'pino';
import * as Rx from 'rxjs';

export { MidnightWalletProvider };

/** The secret a wallet is built from: a hex seed or a BIP-39 mnemonic. */
export type WalletSecret = { kind: 'seed'; value: string } | { kind: 'mnemonic'; value: string };

/**
 * Build an un-started wallet provider. Call `start(false)` on it: the `false`
 * skips testkit's own faucet funding step, which the suites replace with
 * `waitForFunding` below.
 */
export async function buildWallet(
  logger: Logger,
  env: EnvironmentConfiguration,
  secret: WalletSecret,
): Promise<MidnightWalletProvider> {
  const builder = FluentWalletBuilder.forEnvironment(env);
  const { wallet, seeds, keystore } = await (secret.kind === 'mnemonic'
    ? builder.withMnemonic(secret.value)
    : builder.withSeed(secret.value)
  ).buildWithoutStarting();
  logger.info(`Wallet built from ${secret.kind}.`);
  return MidnightWalletProvider.withWallet(
    logger,
    env,
    wallet,
    ZswapSecretKeys.fromSeed(seeds.shielded),
    DustSecretKey.fromSeed(seeds.dust),
    keystore,
  );
}

/** Wait until the wallet has caught up with the chain. `timeout` caps the gap between updates. */
export async function syncWallet(logger: Logger, wallet: WalletFacade, timeout = 300_000): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  const state = await testkitSyncWallet(wallet, 0, timeout);
  logger.info('Wallet synced.');
  return state;
}

// ---------------------------------------------------------------------------
// Which wallet a run uses
// ---------------------------------------------------------------------------

/** Genesis-funded seeds on the local `undeployed` devnet. */
export const LOCAL_SEEDS = {
  ALICE: '0000000000000000000000000000000000000000000000000000000000000001',
  BOB: '0000000000000000000000000000000000000000000000000000000000000002',
  CHARLIE: '0000000000000000000000000000000000000000000000000000000000000003',
  DAVE: '000000000000000000000000000000000000000000000000000000000000000d',
} as const;

export type Role = keyof typeof LOCAL_SEEDS;

/**
 * The wallet for `role` on `network`: a genesis seed on `local`, otherwise
 * `MIDNIGHT_<NETWORK>_<ROLE>_SEED` or `_MNEMONIC` from the repo-root
 * `.env.<network>` that vitest loads. Returns null when neither is set.
 */
export function resolveWallet(network: string, role: Role = 'ALICE'): WalletSecret | null {
  if (network === 'local') return { kind: 'seed', value: LOCAL_SEEDS[role] };
  const prefix = `MIDNIGHT_${network.toUpperCase()}_${role}`;
  const mnemonic = process.env[`${prefix}_MNEMONIC`]?.trim().replace(/\s+/g, ' ');
  const seed = process.env[`${prefix}_SEED`]?.trim();
  if (mnemonic && seed) throw new Error(`Set only one of ${prefix}_MNEMONIC or ${prefix}_SEED.`);
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic };
  if (seed) {
    if (!/^[0-9a-fA-F]+$/.test(seed) || seed.length % 2 !== 0) {
      throw new Error(`${prefix}_SEED must be a hex string of even length (no 0x prefix).`);
    }
    return { kind: 'seed', value: seed };
  }
  return null;
}

/**
 * A throwaway wallet saved in `dir/<networkId>.json` (gitignored), created on
 * first use. For runs with no wallet in the root `.env.<network>`.
 */
export function getOrCreateTestWallet(dir: string, networkId: string): { seed: string; isNew: boolean } {
  const file = join(dir, `${networkId}.json`);
  if (existsSync(file)) {
    return { seed: (JSON.parse(readFileSync(file, 'utf8')) as { seed: string }).seed, isNew: false };
  }
  const seed = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ seed, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return { seed, isNew: true };
}

// ---------------------------------------------------------------------------
// Funding gate for remote runs
// ---------------------------------------------------------------------------
//
// "Synced" is not "funded": a wallet that was never funded is at chain tip
// with no coins. This waits for NIGHT from the faucet, registers it for DUST
// generation, and waits for spendable DUST.
//
// testkit's waitForFunds does the same, but it re-syncs with a fixed 90 s
// timeout after the faucet transfer. Indexers back their progress updates off
// to ~4 min on an idle subscription, so that check can time out although the
// NIGHT has arrived. The DUST wait below is the readiness check instead.

/** How long to wait for a human to visit the faucet, and for DUST to accrue. */
const FUND_TIMEOUT_MS = Number(process.env['MIDNIGHT_FUND_TIMEOUT_MS'] ?? 30 * 60_000);

const hasNight = (s: FacadeState) => Object.values(s.unshielded.balances).some((v) => v > 0n);

/** The indexer's latest block time, or undefined while it can't be read. */
async function latestBlockTime(indexerHttpUrl: string, timeoutMs: number): Promise<Date | undefined> {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { timestamp } }' }),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    const body = (await res.json()) as { data?: { block?: { timestamp?: number } } };
    const ts = body.data?.block?.timestamp;
    return typeof ts === 'number' ? new Date(ts) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wait until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * With `indexerHttpUrl`, also wait until that DUST is worth something at the
 * latest block's time, which is when the wallet values it while balancing. On a
 * fresh local devnet the DUST exists from genesis but is worth 0 until the
 * first block after genesis.
 */
export async function waitForDust(
  logger: Logger,
  wallet: WalletFacade,
  minCoins = 1,
  timeoutMs = 180_000,
  indexerHttpUrl?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  logger.info(`Waiting for >=${minCoins} spendable DUST coin(s) (timeout ${timeoutMs}ms)...`);
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter((s: FacadeState) => s.dust.availableCoins.length >= minCoins),
      Rx.take(1),
      Rx.timeout({
        each: timeoutMs,
        with: () => Rx.throwError(() => new Error(`No spendable DUST coin within ${timeoutMs}ms`)),
      }),
    ),
  );
  if (indexerHttpUrl) {
    for (;;) {
      const blockTime = await latestBlockTime(indexerHttpUrl, Math.min(10_000, deadline - Date.now()));
      if (blockTime && state.dust.balance(blockTime) > 0n) break;
      if (Date.now() > deadline) {
        throw new Error(`DUST still worth 0 at the latest block after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  logger.info('DUST ready.');
}

export interface FundingOptions {
  /**
   * Register the wallet's NIGHT for DUST generation (default true). Pass false
   * for a wallet that must hold NIGHT but no DUST, such as a sponsored user.
   */
  registerDust?: boolean;
  /** Names the wallet in log lines. */
  label?: string;
}

/**
 * Hold until the wallet can pay for transactions on a remote network. Returns
 * at once when it already can, so only a new wallet sees the faucet prompt.
 */
export async function waitForFunding(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
  env: EnvironmentConfiguration,
  { registerDust = true, label = 'wallet' }: FundingOptions = {},
): Promise<void> {
  const address = String(keystore.getBech32Address());
  const current = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (current === null || !hasNight(current)) {
    logger.info(`Fund ${label} with tNIGHT at ${env.faucet}; the run continues once it arrives.`);
    logger.info(`  address: ${address}`);
    if (!registerDust) logger.info('  This wallet must NOT have DUST delegated: send tNIGHT only.');
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter(hasNight),
        Rx.take(1),
        Rx.timeout({
          each: FUND_TIMEOUT_MS,
          with: () => Rx.throwError(() => new Error(`No NIGHT at ${address} within ${FUND_TIMEOUT_MS}ms`)),
        }),
      ),
    );
  }

  if (!registerDust) {
    logger.info(`${label}: NIGHT present; not registering it for DUST, by design.`);
    return;
  }

  const state = await Rx.firstValueFrom(wallet.state());
  const night = unshieldedToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.utxo.type === night && !coin.meta.registeredForDustGeneration,
  );
  if (state.dust.balance(new Date()) === 0n && unregistered.length > 0) {
    logger.info(`${label}: registering ${unregistered.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      unregistered,
      keystore.getPublicKey(),
      (payload) => keystore.signData(payload),
    );
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    logger.info(`${label}: DUST registration submitted (${txId}).`);
  }
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS, env.indexer);
  logger.info(`${label}: funded and ready.`);
}
