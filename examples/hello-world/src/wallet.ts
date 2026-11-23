// The test wallet, built from the published Midnight SDK packages only:
// @midnight-ntwrk/testkit-js supplies the wallet provider and sync helper, and
// @midnightntwrk/wallet-sdk the wallet itself.
//
// A new wallet's first sync takes seconds on a local devnet and about 6 minutes
// on preprod, where it skips the Ledger 8 DUST history. Remote runs still set a
// long MIDNIGHT_SYNC_TIMEOUT_MS (see the test suite).

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
export async function syncWallet(logger: Logger, wallet: WalletFacade, timeout = 300_000): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  const state = await testkitSyncWallet(wallet, 0, timeout);
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
//
// Each save is stamped with the indexer's host and its tip (height and block
// hash), and a restore checks the stamp first. A network reset can keep the
// genesis hash (Preview's on 6 November 2026 did), so without the check a state
// from the old chain would be restored onto the new one. And indexers number
// events differently (Blockfrost's preprod ids run 22 behind the official
// indexer's), so a state from another indexer would resume from the wrong
// cursors. If the check fails, the wallet syncs from genesis and the next save
// replaces the file. A version 1 file (from before stamping) is restored as
// before and gets its stamp on the next save.

const STATE_DIR = fileURLToPath(new URL('../../../.wallet-state/', import.meta.url));
const stateFiles = new WeakMap<WalletFacade, { file: string; indexer: string }>();

type SubWalletStates = { shielded: string; unshielded: string; dust: string };
/** Where a state was synced: the indexer's host (never its URL, which can carry a token) and a block on its chain. */
type ChainStamp = { indexer: string; height: number; blockHash: string };
type SavedWalletState = ({ version: 1 } | { version: 2; chain: ChainStamp }) & SubWalletStates;

/** POST a GraphQL query to the indexer; undefined if it can't be reached. */
async function indexerQuery<T>(indexerHttpUrl: string, query: string): Promise<T | undefined> {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? ((await res.json()) as { data?: T }).data : undefined;
  } catch {
    return undefined;
  }
}

/** A stamp for the indexer's current tip, or undefined if it can't be read. */
async function readChainStamp(indexerHttpUrl: string): Promise<ChainStamp | undefined> {
  const data = await indexerQuery<{ block?: { height?: number; hash?: string } | null }>(
    indexerHttpUrl,
    '{ block { height hash } }',
  );
  const height = data?.block?.height;
  const blockHash = data?.block?.hash;
  if (typeof height !== 'number' || height <= 0 || typeof blockHash !== 'string') return undefined;
  return { indexer: new URL(indexerHttpUrl).host, height, blockHash };
}

/** Null when `stamp` is from this indexer and its block is still on the chain, else why not. */
async function checkChainStamp(indexerHttpUrl: string, stamp: ChainStamp): Promise<string | null> {
  const host = new URL(indexerHttpUrl).host;
  if (stamp.indexer !== host) return `it was synced against ${stamp.indexer}, not ${host}`;
  const data = await indexerQuery<{ block?: { hash?: string } | null }>(
    indexerHttpUrl,
    `{ block(offset: { height: ${Math.trunc(stamp.height)} }) { hash } }`,
  );
  const hash = data?.block?.hash;
  if (typeof hash !== 'string') return `the indexer has no block ${stamp.height} or can't be reached (was the network reset?)`;
  if (hash !== stamp.blockHash) return `block ${stamp.height} is ${hash}, not ${stamp.blockHash} (was the network reset?)`;
  return null;
}

function stateFileFor(networkId: string, masterSeed: string): string | undefined {
  if (networkId === 'undeployed' || process.env['MIDNIGHT_WALLET_STATE'] === 'off') return undefined;
  const id = createHash('sha256').update(masterSeed).digest('hex').slice(0, 16);
  return join(STATE_DIR, `${networkId}-${id}.json`);
}

/**
 * Turn on the Wallet SDK's `skipLedgerV8DustHistory` for the DUST wallet the
 * builder makes. On a chain that crossed the Ledger 9 fork in place (preprod,
 * Preview, Mainnet), the fork emptied all DUST state and re-emitted live
 * DUST as Ledger 9 events, so a fresh wallet can start at the fork instead of
 * replaying every Ledger 8 DUST event from genesis: the slow part of a first
 * sync. Only fresh starts read it (a restore resumes from its saved cursor),
 * and on a chain that never crossed the fork it changes nothing. The cost is
 * the wallet's Ledger 8 DUST transaction history, which the examples don't use.
 * testkit's builder keeps its wallet configuration private, so it is set there.
 */
function skipLedgerV8DustHistory(builder: FluentWalletBuilder): void {
  (builder as unknown as { config: { skipLedgerV8DustHistory?: boolean } }).config.skipLedgerV8DustHistory = true;
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
  skipLedgerV8DustHistory(builder);
  const { wallet: fresh, seeds, keystore } = await builder.buildWithoutStarting();
  const file = stateFileFor(env.networkId, seeds.masterSeed);
  let wallet = fresh;
  if (file && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedWalletState;
      const mismatch = saved.version === 2 ? await checkChainStamp(env.indexer, saved.chain) : null;
      if (mismatch) {
        logger.warn(`Not restoring ${file}: ${mismatch}. Syncing from genesis.`);
      } else {
        wallet = await restoreFacade(builder, saved);
        logger.info(
          saved.version === 2
            ? `Restored wallet state from ${file} (chain check passed at block ${saved.chain.height}).`
            : `Restored wallet state from ${file} (no chain stamp yet; it gets one on the next save).`,
        );
      }
    } catch (error) {
      logger.warn(`Could not restore ${file} (${String(error)}); syncing from genesis.`);
    }
  }
  if (file) stateFiles.set(wallet, { file, indexer: env.indexer });
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
  const target = stateFiles.get(wallet);
  if (!target) return;
  const { file } = target;
  const chain = await readChainStamp(target.indexer);
  if (!chain) {
    // An unstamped save could never be checked, so keep the previous file.
    logger.warn(`Could not read the chain tip from the indexer; not saving wallet state to ${file}.`);
    return;
  }
  const saved: SavedWalletState = {
    version: 2,
    chain,
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

/** How often, and how long to wait, when retrying DUST registration after a protocol-version mismatch. */
const DUST_REGISTRATION_RETRY_ATTEMPTS = 10;
const DUST_REGISTRATION_RETRY_DELAY_MS = 2_000;

const PROTOCOL_VERSION_MISMATCH_TAG =
  '@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError';

function isProtocolVersionMismatchError(err: unknown): boolean {
  // The SDK's error carries `_tag` set to exactly this string (checked on
  // wallet-sdk-abstractions 3.0.0); the `name`/class-name checks add nothing.
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { _tag?: unknown })._tag === PROTOCOL_VERSION_MISMATCH_TAG
  );
}

/**
 * Wallet SDK 2.0.0 can throw ProtocolVersionMismatchError on a
 * `registerNightUtxosForDustGeneration` call made while the facade is still
 * crossing a protocol boundary (midnight-examples#93). `waitForFunding`
 * waits for the facade to settle before registering, but a crossing can
 * still land between that read and this call — so retry over a few blocks
 * as a backstop.
 */
async function registerNightUtxosForDustGenerationRetrying<T>(
  logger: Logger,
  label: string,
  register: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DUST_REGISTRATION_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await register();
    } catch (err) {
      lastError = err;
      if (!isProtocolVersionMismatchError(err) || attempt === DUST_REGISTRATION_RETRY_ATTEMPTS) {
        throw err;
      }
      logger.warn(
        `${label}: DUST registration hit ProtocolVersionMismatchError (attempt ${attempt}/${DUST_REGISTRATION_RETRY_ATTEMPTS}); retrying in ${DUST_REGISTRATION_RETRY_DELAY_MS}ms`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, DUST_REGISTRATION_RETRY_DELAY_MS);
      });
    }
  }
  throw lastError;
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

  // Registration needs the facade settled on one side of a protocol
  // boundary: the first state emission can land mid-crossing, while the
  // facade is still bound to the version the laggard wallets are on, and
  // registration then fails with ProtocolVersionMismatchError
  // (midnight-examples#93). testkit's syncWallet waits for the same
  // `protocol._tag === 'Settled'` reading; the retry below stays as a
  // backstop for a crossing that lands between this read and the call.
  // Bounded overall (`first`, not `each`): the state keeps emitting while the
  // wallets cross, so a per-emission timeout would never fire on a stall.
  let lastProtocol: FacadeState['protocol'] | undefined;
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s: FacadeState) => {
        lastProtocol = s.protocol;
      }),
      Rx.filter((s: FacadeState) => s.protocol._tag === 'Settled'),
      Rx.timeout({
        first: FUND_TIMEOUT_MS,
        with: () =>
          Rx.throwError(() => {
            const p = lastProtocol;
            const behind = p?._tag === 'Crossing' ? ` (${p.behind.join(', ')} behind)` : '';
            return new Error(
              `${label}: wallets still crossing a protocol boundary after ${FUND_TIMEOUT_MS}ms${behind}`,
            );
          }),
      }),
    ),
  );
  const night = unshieldedToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.utxo.type === night && !coin.meta.registeredForDustGeneration,
  );
  if (state.dust.balance(new Date()) === 0n && unregistered.length > 0) {
    logger.info(`${label}: registering ${unregistered.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await registerNightUtxosForDustGenerationRetrying(
      logger,
      label,
      () =>
        wallet.registerNightUtxosForDustGeneration(
          unregistered,
          keystore.getPublicKey(),
          async (payload) => keystore.signData(payload),
        ),
    );
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    logger.info(`${label}: DUST registration submitted (${txId}).`);
  }
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS, env.indexer);
  logger.info(`${label}: funded and ready.`);
}
