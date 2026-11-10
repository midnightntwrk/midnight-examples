// The wallet a project's tests and scripts deploy and call with: a
// Ledger9WalletProvider over a WalletFacade, and syncWallet to wait until it
// has caught up. On remote networks the sub-wallets' state is saved after each
// sync and restored on the next build of the same wallet (see "Saved wallet
// state" below), so only the gap since the last run is synced.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  type PreBinding,
  type Proof,
  type SignatureEnabled,
  Transaction,
  LedgerParameters,
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
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

import { type FastSyncOptions } from './fast-wallet.js';
import type { WalletSecret } from './types.js';

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
   * @midnightntwrk/mnkit-coins, and the wallet pays for it from whichever
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
   * Build an un-started wallet provider.
   *
   * This is the normal `FluentWalletBuilder` path. On a remote network, a
   * wallet synced before with the same seed is restored from its saved state.
   * `opts.fastSync` (pre-seeding from a shipped reference bundle) is accepted
   * but disabled until it is ported to wallet SDK 2; see FAST-SYNC.md.
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
    opts?: { fastSync?: FastSyncOptions },
  ): Promise<MidnightWalletProvider> {
    if (opts?.fastSync) {
      // Pre-seeding rewrites wallet SDK v1 snapshots and is not ported to
      // wallet SDK 2 (Ledger 9) yet, so it is off: every wallet takes the
      // normal path below, and saved state (remote networks) makes later
      // builds of the same wallet fast instead. See FAST-SYNC.md.
      logger.info('Fast-sync pre-seeding is disabled on Ledger 9; using the normal sync (with saved state).');
    }

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
// off. The directory is .wallet-state/ under the working directory (the
// project root when run through npm scripts), or MIDNIGHT_WALLET_STATE_DIR.

const stateDir = (): string => resolve(process.env['MIDNIGHT_WALLET_STATE_DIR'] ?? '.wallet-state');
const stateFiles = new WeakMap<WalletFacade, string>();

type SavedWalletState = { version: 1; shielded: string; unshielded: string; dust: string };

function stateFileFor(networkId: string, masterSeed: string): string | undefined {
  if (networkId === 'undeployed' || process.env['MIDNIGHT_WALLET_STATE'] === 'off') return undefined;
  const id = createHash('sha256').update(masterSeed).digest('hex').slice(0, 16);
  return join(stateDir(), `${networkId}-${id}.json`);
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
