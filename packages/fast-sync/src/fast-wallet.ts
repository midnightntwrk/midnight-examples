// Build an un-started WalletFacade and the keys a caller needs alongside it.
//
// Fast-sync pre-seeding (restoring a brand-new wallet from a shipped reference
// bundle so it starts near chain tip) rewrote wallet SDK v1 snapshots and
// wrapped the v1 sync builders (preseed.ts, dedup.ts). Wallet SDK 2 (Ledger 9)
// changed both, and pre-seeding is not ported yet, so it is disabled: a
// `fastSync` option is accepted and ignored, and every wallet is built the way
// testkit's FluentWalletBuilder builds one. See FAST-SYNC.md.

import { LedgerParameters, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { type UnshieldedKeystore, type WalletFacade, type WalletSeeds } from '@midnightntwrk/wallet-sdk';
import { type DustWalletOptions, type EnvironmentConfiguration, FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import type { Logger } from 'pino';
import type { WalletSecret } from './types.js';

const DUST_OPTIONS: DustWalletOptions = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: 1_000n,
  feeBlocksMargin: 5,
};

/** Opt-in fast-sync configuration. Omit it entirely for a normal genesis sync. */
export interface FastSyncOptions {
  /** Directory holding `<networkId>/{manifest.json,*.dat.gz}` reference bundles. */
  referenceRoot: string;
  /**
   * The wallet's birthday (chain height at creation) for the safety guard. Omit
   * and it is read from the indexer's current tip — correct ONLY for a wallet
   * created right now. A wallet with prior history must pass the height it was
   * created at, or it must not enable fast-sync at all.
   */
  birthday?: number;
}

/** What `assembleWallet` hands back. */
export interface AssembledWallet {
  facade: WalletFacade;
  /** The seeds the facade is started with: `facade.start(seeds)`. */
  seeds: WalletSeeds;
  zswapSecretKeys: ZswapSecretKeys;
  keystore: UnshieldedKeystore;
  /** Which sub-wallets were seeded from a reference: always empty while pre-seeding is disabled. */
  seeded: string[];
  /** Reference height used: always null while pre-seeding is disabled. */
  referenceHeight: number | null;
  /**
   * The three sub-wallets behind the facade, for `serializeState()` (cutting a
   * reference bundle). Ordinary callers should drive the facade.
   */
  subWallets: {
    shielded: SerializableSubWallet;
    unshielded: SerializableSubWallet;
    dust: SerializableSubWallet;
  };
}

/** The one method the bundle cutter needs off a sub-wallet. */
export interface SerializableSubWallet {
  serializeState(): Promise<string>;
}

/** Read the indexer's current tip height, or undefined if it cannot be reached. */
export async function getChainTipHeight(indexerHttpUrl: string): Promise<number | undefined> {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query { block { height } }' }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: { block?: { height?: number } | null } };
    const height = json.data?.block?.height;
    return typeof height === 'number' && height > 0 ? height : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive keys and build an un-started WalletFacade. `fastSync` is accepted for
 * compatibility and ignored while pre-seeding is disabled.
 */
export async function assembleWallet(
  logger: Logger,
  env: EnvironmentConfiguration,
  secret: WalletSecret,
  fastSync?: FastSyncOptions,
): Promise<AssembledWallet> {
  if (fastSync) {
    logger.info('Fast-sync pre-seeding is disabled on Ledger 9; syncing normally.');
  }
  const base = FluentWalletBuilder.forEnvironment(env).withDustOptions(DUST_OPTIONS);
  const builder = secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);
  const { wallet, seeds, keystore } = await builder.buildWithoutStarting();
  return {
    facade: wallet,
    seeds,
    zswapSecretKeys: ZswapSecretKeys.fromSeed(seeds.shielded),
    keystore,
    seeded: [],
    referenceHeight: null,
    subWallets: { shielded: wallet.shielded, unshielded: wallet.unshielded, dust: wallet.dust },
  };
}
