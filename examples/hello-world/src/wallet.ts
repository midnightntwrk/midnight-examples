// The test wallet, built from the published Midnight SDK packages only:
// @midnight-ntwrk/testkit-js supplies the wallet provider and sync helper, and
// @midnightntwrk/wallet-sdk the wallet itself.
//
// A wallet syncs from genesis. On a local devnet that takes seconds; on preprod
// it can take over an hour the first time, so remote runs set a long
// MIDNIGHT_SYNC_TIMEOUT_MS (see the test suite).

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';
import {
  DEFAULT_DUST_OPTIONS,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  MidnightWalletProvider,
  logger as testkitLogger,
  syncWallet as testkitSyncWallet,
} from '@midnight-ntwrk/testkit-js';
import {
  DustWallet,
  type FacadeState,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  ShieldedWallet,
  type UnshieldedKeystore,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import type { Logger } from 'pino';
import * as Rx from 'rxjs';

export { MidnightWalletProvider };

// testkit logs through its own module-level logger. At info it prints the
// wallet's indexer and relay URLs, which carry the Blockfrost project_id, and
// two lines per sync update. Keep only its warnings and errors.
testkitLogger.level = 'warn';

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
  const provider = await buildProvider(
    logger,
    env,
    secret.kind === 'mnemonic' ? builder.withMnemonic(secret.value) : builder.withSeed(secret.value),
  );
  logger.info(`Wallet built from ${secret.kind}.`);
  return provider;
}

/** Wait until the wallet has caught up with the chain. `timeout` caps the gap between updates. */
// ---------------------------------------------------------------------------
// Sync progress
// ---------------------------------------------------------------------------
// A genesis sync on a long-lived network can take an hour or more, most of it
// in the DUST wallet replaying the chain's DUST events. While a sync runs this
// logs, every MIDNIGHT_SYNC_PROGRESS_MS (default 30 s; 0 turns it off), each
// sub-wallet's applied/highest index, the DUST replay rate and a rough ETA, and
// how long since the wallet last reported any state. Follow it with:
//
//   grep 'sync progress' examples/<example>/logs/<run>.log

type IndexProgress = { applied: bigint; highest: bigint; connected: boolean } | undefined;

function readProgress(progress: unknown): IndexProgress {
  if (!progress || typeof progress !== 'object') return undefined;
  const p = progress as Record<string, unknown>;
  const applied = p['appliedIndex'] ?? p['appliedId'];
  const highest = p['highestIndex'] ?? p['highestTransactionId'];
  if (typeof applied !== 'bigint' || typeof highest !== 'bigint') return undefined;
  return { applied, highest, connected: p['isConnected'] !== false };
}

function describeProgress(p: IndexProgress): string {
  if (!p) return '?';
  const pct = p.highest > 0n ? Number((p.applied * 10_000n) / p.highest) / 100 : 0;
  return `${p.applied}/${p.highest} (${pct.toFixed(2)}%)${p.connected ? '' : ' DISCONNECTED'}`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m${s % 60}s`;
}

/** Log sync progress until the returned function is called. */
export function trackSyncProgress(logger: Logger, wallet: WalletFacade): () => void {
  const everyMs = Number(process.env['MIDNIGHT_SYNC_PROGRESS_MS'] ?? 30_000);
  if (!(everyMs > 0)) return () => {};
  const startedAt = Date.now();
  let latest: FacadeState | undefined;
  let lastUpdateAt = startedAt;
  let dustStart: { at: number; applied: bigint } | undefined;
  const sub = wallet.state().subscribe({
    next: (s: FacadeState) => {
      latest = s;
      lastUpdateAt = Date.now();
    },
    error: () => {},
  });
  const timer = setInterval(() => {
    const now = Date.now();
    if (!latest) {
      logger.info(`sync progress: no wallet state yet after ${formatDuration(now - startedAt)}`);
      return;
    }
    const dust = readProgress(latest.dust.progress);
    let rate = '';
    if (dust) {
      dustStart ??= { at: lastUpdateAt, applied: dust.applied };
      const secs = (now - dustStart.at) / 1000;
      const perSec = secs > 0 ? Number(dust.applied - dustStart.applied) / secs : 0;
      const left = Number(dust.highest - dust.applied);
      rate = ` ${perSec.toFixed(1)} ev/s` + (perSec > 0 && left > 0 ? `, ETA ${formatDuration((left / perSec) * 1000)}` : '');
    }
    logger.info(
      `sync progress [${formatDuration(now - startedAt)}]: dust ${describeProgress(dust)}${rate}; ` +
        `shielded ${describeProgress(readProgress(latest.shielded.progress))}; ` +
        `unshielded ${describeProgress(readProgress(latest.unshielded.progress))}; ` +
        `last update ${formatDuration(now - lastUpdateAt)} ago`,
    );
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    sub.unsubscribe();
  };
}

export async function syncWallet(logger: Logger, wallet: WalletFacade, timeout = 300_000): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  const stopProgress = trackSyncProgress(logger, wallet);
  const state = await testkitSyncWallet(wallet, 0, timeout).finally(stopProgress);
  logger.info('Wallet synced.');
  await saveWalletState(logger, wallet);
  return state;
}

// ---------------------------------------------------------------------------
// Saved wallet state (remote networks)
// ---------------------------------------------------------------------------
// On a long-lived network a sync from genesis takes minutes per wallet, and
// every suite builds its wallets afresh. So after each sync the three
// sub-wallets' state is saved to the gitignored repo-root .wallet-state/,
// keyed by network ID and a hash of the master seed, and the next build of the
// same wallet restores it and syncs only the gap. The local devnet is skipped:
// it starts from a new genesis each time. MIDNIGHT_WALLET_STATE=off turns this
// off.

const STATE_DIR = fileURLToPath(new URL('../../../.wallet-state/', import.meta.url));
const stateFiles = new WeakMap<WalletFacade, string>();

type SavedWalletState = { version: 1; shielded: string; unshielded: string; dust: string };

function stateFileFor(networkId: string, masterSeed: string): string | undefined {
  if (networkId === 'undeployed' || process.env['MIDNIGHT_WALLET_STATE'] === 'off') return undefined;
  const id = createHash('sha256').update(masterSeed).digest('hex').slice(0, 16);
  return join(STATE_DIR, `${networkId}-${id}.json`);
}

/** The three sub-wallets restored from a snapshot, configured as testkit's WalletFactory configures new ones. */
async function restoreFacade(builder: FluentWalletBuilder, saved: SavedWalletState): Promise<WalletFacade> {
  // testkit keeps the builder's wallet configuration private and does not
  // export the function that derives it; reuse it so a restored wallet is
  // configured exactly like a new one.
  const config = (builder as unknown as { config: Parameters<typeof ShieldedWallet>[0] }).config;
  const shielded = ShieldedWallet(config).restore(saved.shielded);
  const unshielded = UnshieldedWallet({
    ...config,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  } as Parameters<typeof UnshieldedWallet>[0]).restore(saved.unshielded);
  const dust = DustWallet({
    ...config,
    costParameters: {
      ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams,
      additionalFeeOverhead: DEFAULT_DUST_OPTIONS.additionalFeeOverhead,
      feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin,
    },
  } as Parameters<typeof DustWallet>[0]).restore(saved.dust);
  return WalletFacade.init({
    configuration: config as Parameters<typeof WalletFacade.init>[0]['configuration'],
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
  });
}

async function buildProvider(
  logger: Logger,
  env: EnvironmentConfiguration,
  builder: FluentWalletBuilder,
): Promise<MidnightWalletProvider> {
  const { wallet: fresh, seeds, keystore } = await builder.buildWithoutStarting();
  const file = stateFileFor(env.networkId, seeds.masterSeed);
  let wallet = fresh;
  if (file && existsSync(file)) {
    try {
      wallet = await restoreFacade(builder, JSON.parse(readFileSync(file, 'utf8')) as SavedWalletState);
      logger.info(`Restored wallet state from ${file}.`);
    } catch (error) {
      logger.warn(`Could not restore ${file} (${String(error)}); syncing from genesis.`);
    }
  }
  if (file) stateFiles.set(wallet, file);
  return MidnightWalletProvider.withWallet(logger, env, wallet, seeds, keystore);
}

/**
 * Build an un-started wallet provider from a hex master seed, restoring saved
 * state when there is some. Use it in place of `MidnightWalletProvider.build`,
 * which also logs the seed.
 */
export async function buildWalletFromSeed(
  logger: Logger,
  env: EnvironmentConfiguration,
  seed: string,
): Promise<MidnightWalletProvider> {
  return buildProvider(logger, env, FluentWalletBuilder.forEnvironment(env).withSeed(seed));
}

/** Save the wallet's state for the next build of the same wallet (no-op on the local devnet). */
export async function saveWalletState(logger: Logger, wallet: WalletFacade): Promise<void> {
  const file = stateFiles.get(wallet);
  if (!file) return;
  const saved: SavedWalletState = {
    version: 1,
    shielded: await wallet.shielded.serializeState(),
    unshielded: await wallet.unshielded.serializeState(),
    dust: await wallet.dust.serializeState(),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, JSON.stringify(saved), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  logger.info(`Saved wallet state to ${file}.`);
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

/** 1 DUST is 10^15 Specks (SPECKS_PER_DUST in the ledger). */
const SPECKS_PER_DUST = 10n ** 15n;

/**
 * The DUST a wallet must hold before a suite transacts: enough to pay for a
 * deploy. MIDNIGHT_MIN_DUST overrides it, in DUST (default 60).
 */
const MIN_DUST_SPECKS = BigInt(
  Math.round(Number(process.env['MIDNIGHT_MIN_DUST'] ?? '60') * 1e6),
) * (SPECKS_PER_DUST / 10n ** 6n);

function formatDust(specks: bigint): string {
  return `${specks / SPECKS_PER_DUST}.${(specks % SPECKS_PER_DUST).toString().padStart(15, '0').slice(0, 6)}`;
}

/**
 * Wait until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * With `indexerHttpUrl`, also wait until the DUST is worth at least
 * MIN_DUST_SPECKS at the latest block's time, which is when the wallet values
 * it while balancing. DUST accrues after registration, so a freshly registered
 * wallet holds a coin worth almost nothing, too little to pay for a deploy
 * ("could not balance dust"). On a fresh local devnet the DUST exists from
 * genesis but is worth 0 until the first block after genesis.
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
    logger.info(`Waiting for >=${formatDust(MIN_DUST_SPECKS)} DUST at the latest block...`);
    let latest = state;
    let lastLogged = 0;
    for (;;) {
      const blockTime = await latestBlockTime(indexerHttpUrl, Math.min(10_000, deadline - Date.now()));
      const balance = blockTime ? latest.dust.balance(blockTime) : 0n;
      if (balance >= MIN_DUST_SPECKS) break;
      if (Date.now() > deadline) {
        throw new Error(
          `DUST at ${formatDust(balance)}, below ${formatDust(MIN_DUST_SPECKS)}, after ${timeoutMs}ms`,
        );
      }
      if (Date.now() - lastLogged >= 60_000) {
        logger.info(`  DUST ${formatDust(balance)} / ${formatDust(MIN_DUST_SPECKS)}`);
        lastLogged = Date.now();
      }
      await new Promise((r) => setTimeout(r, 5_000));
      latest = await Rx.firstValueFrom(wallet.state());
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
 * On mainnet the wallet holds real funds, so before anything is signed the
 * address derived from the mnemonic must equal MIDNIGHT_MAINNET_ALICE_ADDRESS
 * (copy it from Lace). This catches the wrong mnemonic, or a key derivation
 * that differs from the wallet the funds live in.
 */
export function assertExpectedMainnetAddress(address: string): void {
  const expected = process.env['MIDNIGHT_MAINNET_ALICE_ADDRESS']?.trim();
  if (!expected) {
    throw new Error(
      'MIDNIGHT_MAINNET_ALICE_ADDRESS is not set. Copy the unshielded address from Lace into the ' +
        `repo-root .env.mainnet. The mnemonic derives ${address}.`,
    );
  }
  if (address !== expected) {
    throw new Error(
      `The mnemonic derives ${address}, not MIDNIGHT_MAINNET_ALICE_ADDRESS (${expected}). ` +
        'Stopping before any transaction.',
    );
  }
}

/** The wallet's DUST, valued at the latest block's time (or now if unreadable). */
async function dustAtLatestBlock(wallet: WalletFacade, indexerHttpUrl: string): Promise<bigint> {
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (state === null) return 0n;
  const blockTime = (await latestBlockTime(indexerHttpUrl, 10_000)) ?? new Date();
  return state.dust.balance(blockTime);
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
  const isMainnet = env.networkId === 'mainnet';
  if (isMainnet) assertExpectedMainnetAddress(address);

  // DUST first: a wallet that can already pay needs no NIGHT and no
  // registration. A mainnet wallet whose DUST comes from cNIGHT registered on
  // Cardano holds no NIGHT on Midnight at all.
  if (registerDust) {
    const dust = await dustAtLatestBlock(wallet, env.indexer);
    if (dust >= MIN_DUST_SPECKS) {
      logger.info(`${label}: ${formatDust(dust)} DUST at the latest block; ready.`);
      return;
    }
    if (isMainnet) {
      throw new Error(
        `${label} at ${address} has ${formatDust(dust)} DUST, below the ${formatDust(MIN_DUST_SPECKS)} ` +
          'a run needs (MIDNIGHT_MIN_DUST). Mainnet has no faucet: wait for DUST to accrue in Lace.',
      );
    }
  }

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
      async (payload) => keystore.signData(payload),
    );
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    logger.info(`${label}: DUST registration submitted (${txId}).`);
  }
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS, env.indexer);
  logger.info(`${label}: funded and ready.`);
}
