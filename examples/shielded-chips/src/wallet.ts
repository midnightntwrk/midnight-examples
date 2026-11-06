// This file is part of example-shielded-chips.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  type PreBinding,
  type Proof,
  type SignatureEnabled,
  Transaction,
  LedgerParameters,
  unshieldedToken,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/v9';
import {
  LedgerTransaction,
  type Ledger9WalletProvider,
  type TransactionAnswer,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  DefaultForkSchedule,
  ProtocolVersion,
  WalletTransaction,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  type FacadeState,
  type UnshieldedKeystore,
  type WalletSeeds,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  logger as testkitLogger,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

// A proven, not yet bound ledger 9 transaction: what a contract call or deploy
// hands the wallet to balance.
type UnboundTransaction = Transaction<SignatureEnabled, Proof, PreBinding>;

/**
 * Midnight.js 5 passes transactions as era-tagged byte handles. Decode a proven
 * one into the ledger 9 transaction the wallet SDK balances.
 */
export function unboundFromHandle(handle: LedgerTransaction<'Unbound'>): UnboundTransaction {
  if (handle.era !== 'v9') throw new Error(`expected a ledger 9 transaction, got ${handle.era}`);
  return Transaction.deserialize('signature', 'proof', 'pre-binding', handle.serialize());
}

/** The secret a wallet is built from: a hex seed or a BIP-39 mnemonic. */
export type WalletSecret = { kind: 'seed'; value: string } | { kind: 'mnemonic'; value: string };

// testkit logs through its own module-level logger. At info it prints the
// wallet's indexer and relay URLs, which carry the Blockfrost project_id, and
// two lines per sync update. Keep only its warnings and errors.
testkitLogger.level = 'warn';

export class MidnightWalletProvider implements Ledger9WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private readonly zswapSecretKeys: ZswapSecretKeys;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly seeds: WalletSeeds,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
    this.zswapSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  // Wallet SDK 2 balances and submits handles adopted at the chain's current
  // protocol version, and hands back a handle to unwrap. The keys come from the
  // seeds the wallet was started with, so balancing no longer takes them.
  async balanceTx(
    handle: LedgerTransaction<'Unbound'>,
    ttl: Date = ttlOneHour(),
  ): Promise<TransactionAnswer> {
    const tx = unboundFromHandle(handle);
    const active = await this.activeProtocolVersion();
    const recipe = await this.wallet.balanceUnboundTransaction(
      WalletTransaction.adopt('Unbound', tx, active),
      { ttl },
    );
    // Balancing may add unshielded inputs (e.g. NIGHT spent to fund a
    // contract's receiveUnshielded). Those inputs need signatures from the
    // unshielded keystore; without this step the node rejects the transaction
    // with InputsSignaturesLengthMismatch (Custom error 192).
    const signed = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signDataAsync(payload),
    );
    const finalized = await this.wallet.finalizeRecipe(signed);
    const accepted = ProtocolVersion.epochOf(active, DefaultForkSchedule.v9);
    const unwrapped = WalletTransaction.unwrapWithin<FinalizedTransaction>(finalized, accepted);
    if (unwrapped._tag === 'Left') throw unwrapped.left;
    return unwrapped.right;
  }

  async submitTx(tx: LedgerTransaction<'Finalized', 'v9'> | FinalizedTransaction): Promise<string> {
    const finalized: FinalizedTransaction = LedgerTransaction.isLedgerTransaction(tx)
      ? Transaction.deserialize('signature', 'proof', 'binding', tx.serialize())
      : tx;
    const active = await this.activeProtocolVersion();
    return this.wallet.submitTransaction(WalletTransaction.adopt('Finalized', finalized, active));
  }

  private async activeProtocolVersion(): Promise<ProtocolVersion.ProtocolVersion> {
    return (await Rx.firstValueFrom(this.wallet.state())).activeProtocolVersion;
  }

  /** This wallet's own shielded address, for self-transfers. */
  getShieldedAddress(): ShieldedAddress {
    return new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(this.getCoinPublicKey()),
      ShieldedEncryptionPublicKey.fromHexString(this.getEncryptionPublicKey()),
    );
  }

  /**
   * Send `amount` of `tokenType` from this wallet back to itself.
   *
   * You don't need this to pay a contract. A coin a circuit `receiveShielded`s
   * is a NEW coin the transaction creates: pass `freshCoin(color, value)` from
   * src/test/coins.ts, and the wallet pays for it from whichever
   * coins it selects and makes change. That pays an exact amount, and since
   * the nonce is fresh, nobody who knows your wallet's coins (whoever minted or
   * sent them) can recognise it. Earlier examples did a self-transfer like
   * this before every deposit to get the same effect.
   *
   * What it is for: reshaping the wallet itself, for example to hold a coin of
   * an exact value for a test.
   */
  async splitShieldedCoin(
    tokenType: string,
    amount: bigint,
    ttl: Date = ttlOneHour(),
  ): Promise<void> {
    const balanceOf = async (): Promise<bigint> => {
      const state = await this.wallet.waitForSyncedState();
      return state.shielded.balances[tokenType] ?? 0n;
    };
    // A self-transfer is value preserving for this token (fees are paid in
    // DUST), so the pre-transfer balance is what we wait to see come back.
    const expected = await balanceOf();

    this.logger.info(`Self-transferring ${amount} of ${tokenType.slice(0, 16)}… to re-nonce`);
    const recipe = await this.wallet.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [{ type: tokenType, receiverAddress: this.getShieldedAddress(), amount }],
        },
      ],
      { ttl, payFees: true },
    );
    const signed = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signDataAsync(payload),
    );
    const finalized = await this.wallet.finalizeRecipe(signed);
    await this.wallet.submitTransaction(finalized);

    // submitTransaction returns once the transaction is accepted, not once it
    // is on chain and indexed. Until then the input coin is spent and the
    // replacement is not visible yet, so wait for the balance to reappear
    // before anyone tries to use the new coin.
    const deadline = Date.now() + 300_000;
    for (;;) {
      if ((await balanceOf()) === expected) {
        this.logger.info('Re-nonced coin is visible; split complete');
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`Split of ${tokenType} did not settle within 300s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.seeds);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  /**
   * Build an un-started wallet provider from a seed or mnemonic. The wallet
   * syncs from genesis: seconds on a local devnet, over an hour on preprod.
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const base = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);
    const builder =
      secret.kind === 'mnemonic'
        ? base.withMnemonic(secret.value)
        : base.withSeed(secret.value);

    const built = await builder.buildWithoutStarting();
    const { seeds, keystore } = built;
    const wallet = await restoreSavedState(logger, env, builder, dustOptions, built.wallet, seeds.masterSeed);

    logger.info(
      `Wallet built from ${secret.kind}; master seed: ${seeds.masterSeed.slice(0, 8)}...`,
    );

    return new MidnightWalletProvider(logger, wallet, seeds, keystore);
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.progress);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`,
        );
        if (!shielded) {
          logger.debug(`  shielded.progress: ${JSON.stringify(state.shielded.progress)}`);
        }
        if (!unshielded) {
          logger.debug(`  unshielded.progress: ${JSON.stringify(state.unshielded.progress)}`);
        }
        if (!dust) {
          logger.debug(`  dust.progress: ${JSON.stringify(state.dust.progress)}`);
        }
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.progress) &&
          isProgressStrictlyComplete(state.dust.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received)`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
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
async function restoreFacade(
  builder: FluentWalletBuilder,
  dustOptions: DustWalletOptions,
  saved: SavedWalletState,
): Promise<WalletFacade> {
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
      ledgerParams: dustOptions.ledgerParams,
      additionalFeeOverhead: dustOptions.additionalFeeOverhead,
      feeBlocksMargin: dustOptions.feeBlocksMargin,
    },
  } as Parameters<typeof DustWallet>[0]).restore(saved.dust);
  return WalletFacade.init({
    configuration: config as Parameters<typeof WalletFacade.init>[0]['configuration'],
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
  });
}

/** The saved wallet for this seed and network if there is one, else `fresh`. */
async function restoreSavedState(
  logger: Logger,
  env: EnvironmentConfiguration,
  builder: FluentWalletBuilder,
  dustOptions: DustWalletOptions,
  fresh: WalletFacade,
  masterSeed: string,
): Promise<WalletFacade> {
  const file = stateFileFor(env.networkId, masterSeed);
  let wallet = fresh;
  if (file && existsSync(file)) {
    try {
      wallet = await restoreFacade(builder, dustOptions, JSON.parse(readFileSync(file, 'utf8')) as SavedWalletState);
      logger.info(`Restored wallet state from ${file}.`);
    } catch (error) {
      logger.warn(`Could not restore ${file} (${String(error)}); syncing from genesis.`);
    }
  }
  if (file) stateFiles.set(wallet, file);
  return wallet;
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

/** The four wallets a remote run is funded with. */
export type Role = keyof typeof LOCAL_SEEDS;

/** Suite-specific role names and the wallet each one uses. */
const ROLE_ALIASES: Record<string, Role> = {
  ALICE: 'ALICE',
  BOB: 'BOB',
  CHARLIE: 'CHARLIE',
  DAVE: 'DAVE',
  ORGANIZER: 'ALICE',
  BIDDER_ONE: 'BOB',
  BIDDER_TWO: 'CHARLIE',
};

export interface ResolvedWallet {
  secret: WalletSecret;
  /** The wallet `role` resolved to. */
  role: Role;
}

function readSecret(prefix: string): WalletSecret | null {
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
 * The wallet for `role` on `network`: a genesis seed on `local`, otherwise
 * `MIDNIGHT_<NETWORK>_<ROLE>_SEED` or `_MNEMONIC` from the repo-root
 * `.env.<network>` that vitest loads. A suite-specific role (such as
 * ORGANIZER) is looked up under its own name first, then under the wallet it
 * maps to.
 */
export function resolveWallet(network: string, role = 'ALICE'): ResolvedWallet {
  const canonical = ROLE_ALIASES[role.toUpperCase()];
  if (!canonical) {
    throw new Error(`Unknown wallet role '${role}'. Known roles: ${Object.keys(ROLE_ALIASES).join(', ')}.`);
  }
  if (network === 'local') return { secret: { kind: 'seed', value: LOCAL_SEEDS[canonical] }, role: canonical };

  const upper = network.toUpperCase();
  const prefixes = [`MIDNIGHT_${upper}_${role.toUpperCase()}`, `MIDNIGHT_${upper}_${canonical}`];
  for (const prefix of new Set(prefixes)) {
    const secret = readSecret(prefix);
    if (secret) return { secret, role: canonical };
  }
  throw new Error(
    `No wallet for role '${canonical}' on network '${network}'. Set ` +
      `MIDNIGHT_${upper}_${canonical}_SEED (or _MNEMONIC) in the repo-root .env.${network}.`,
  );
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

export interface FundingGateOptions {
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
export async function waitForNightThenDust(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
  envConfig: EnvironmentConfiguration,
  faucet: string,
  { registerDust = true, label = 'wallet' }: FundingGateOptions = {},
): Promise<void> {
  const address = String(keystore.getBech32Address());
  // Bounded peek: if state() hasn't emitted yet, assume "not funded" and fall
  // into the wait below, which has its own timeout.
  const current = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (current === null || !hasNight(current)) {
    logger.info(`Fund ${label} with tNIGHT at ${faucet}; the run continues once it arrives.`);
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
      (payload) => keystore.signDataAsync(payload),
    );
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    logger.info(`${label}: DUST registration submitted (${txId}).`);
  }
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS, envConfig.indexer);
  logger.info(`${label}: funded and ready.`);
}
