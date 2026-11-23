// Build an un-started WalletFacade and the keys a caller needs alongside it,
// the way testkit's FluentWalletBuilder builds one.

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

/** What `assembleWallet` hands back. */
export interface AssembledWallet {
  facade: WalletFacade;
  /** The seeds the facade is started with: `facade.start(seeds)`. */
  seeds: WalletSeeds;
  zswapSecretKeys: ZswapSecretKeys;
  keystore: UnshieldedKeystore;
  /** The three sub-wallets behind the facade, for `serializeState()`. Ordinary callers should drive the facade. */
  subWallets: {
    shielded: SerializableSubWallet;
    unshielded: SerializableSubWallet;
    dust: SerializableSubWallet;
  };
}

/** The one method `serializeState()` callers need off a sub-wallet. */
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

/** Derive keys and build an un-started WalletFacade. */
export async function assembleWallet(
  logger: Logger,
  env: EnvironmentConfiguration,
  secret: WalletSecret,
): Promise<AssembledWallet> {
  const base = FluentWalletBuilder.forEnvironment(env).withDustOptions(DUST_OPTIONS);
  const builder = secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);
  skipLedgerV8DustHistory(builder);
  const { wallet, seeds, keystore } = await builder.buildWithoutStarting();
  return {
    facade: wallet,
    seeds,
    zswapSecretKeys: ZswapSecretKeys.fromSeed(seeds.shielded),
    keystore,
    subWallets: { shielded: wallet.shielded, unshielded: wallet.unshielded, dust: wallet.dust },
  };
}

/**
 * Turn on the Wallet SDK's `skipLedgerV8DustHistory` for the DUST wallet the
 * builder makes. On a chain that crossed the Ledger 9 fork in place (preprod,
 * Mainnet), the fork emptied all DUST state and re-emitted live DUST as
 * Ledger 9 events, so a fresh wallet can start at the fork instead of
 * replaying every Ledger 8 DUST event from genesis: the slow part of a first
 * sync. Only fresh starts read it (a restore resumes from its saved cursor),
 * and on a chain that never crossed the fork it changes nothing. The cost is
 * the wallet's Ledger 8 DUST transaction history, which test wallets don't use.
 * testkit's builder keeps its wallet configuration private, so it is set there.
 */
export function skipLedgerV8DustHistory(builder: FluentWalletBuilder): void {
  (builder as unknown as { config: { skipLedgerV8DustHistory?: boolean } }).config.skipLedgerV8DustHistory = true;
}
