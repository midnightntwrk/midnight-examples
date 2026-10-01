// Midnight.js 5 provider set, one per (wallet, contract).
//
// Differences from mn-examples' ledger 8 templates/example/src/providers.ts:
// - `contractModuleProvider` (new, optional in 5.x) is wired through. Without
//   it a circuit that makes a cross-contract call fails with
//   ModuleResolutionError kind 'ModuleProviderAbsent'.
// - For cross-contract proving the proof provider is built over a
//   ZKConfigRegistry of a whole artifact root, so the callee's keys can be
//   found by verifier-key hash, not just the caller's.
// - NodeZkConfigProvider defaults to verify:'require', which needs the
//   compiler/contract-manifest.json that compactc 0.33+ emits. Our 0.35.0
//   artefacts have it, so the default stays.
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractModuleProvider } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import {
  NodeZkConfigProvider,
  nodeZkConfigRegistry,
} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { LOCAL_ENV } from './config.js';

export type Providers = MidnightProviders<any, any, any>;

export interface ProviderOptions {
  /** Directory of this contract's managed output (contract/managed/<name>). */
  managedDir: string;
  /** Unique per test run so level stores never collide. */
  storeName: string;
  /** Root holding every managed dir a cross-contract call may touch. */
  artifactRoot?: string;
  /** Address -> module resolution for cross-contract calls. */
  contractModuleProvider?: ContractModuleProvider;
}

// The level store password policy: >= 16 chars, >= 3 character classes, no
// runs of 3 repeated characters, no 4-character sequences.
const PASSWORD = 'Q3-Ledger9-Acceptance!';

export async function buildProviders(
  wallet: MidnightWalletProvider,
  opts: ProviderOptions,
): Promise<Providers> {
  const zkConfigProvider = new NodeZkConfigProvider<string>(opts.managedDir);
  const proofKeys = opts.artifactRoot
    ? await nodeZkConfigRegistry(opts.artifactRoot)
    : zkConfigProvider;
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: opts.storeName,
      privateStoragePasswordProvider: () => PASSWORD,
      accountId: String(wallet.getCoinPublicKey()),
    }),
    publicDataProvider: indexerPublicDataProvider(LOCAL_ENV.indexer, LOCAL_ENV.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(LOCAL_ENV.proofServer, proofKeys),
    walletProvider: wallet,
    midnightProvider: wallet,
    ...(opts.contractModuleProvider ? { contractModuleProvider: opts.contractModuleProvider } : {}),
  };
}

/** A store name that is unique per process and call. */
export const uniqueStore = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
