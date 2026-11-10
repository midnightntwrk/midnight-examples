// This file is part of example-leaderboard.
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

// Browser-side provider setup for the leaderboard DApp. Connects to the Lace
// wallet through the DApp Connector API and hands the wallet's services to the
// LeaderboardAPI.

import { LeaderboardAPI, type LeaderboardCircuitKeys, type LeaderboardProviders } from '../../../api/index';
import { type LeaderboardPrivateState } from '../../../contract/index';
import { type ContractAddress, fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/v9';
import { BehaviorSubject, catchError, concatMap, filter, firstValueFrom, interval, map, type Observable, take, throwError, timeout } from 'rxjs';
import { type Logger } from 'pino';
import { type ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
  type LedgerTransaction,
} from '@midnight-ntwrk/midnight-js-types';
import semver from 'semver';
import { inMemoryPrivateStateProvider } from '../in-memory-private-state-provider';
import { type NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export type LeaderboardDeployment =
  | { readonly status: 'in-progress' }
  | { readonly status: 'deployed'; readonly api: LeaderboardAPI }
  | { readonly status: 'failed'; readonly error: Error };

/**
 * Manages leaderboard contract connections in a browser setting.
 * Connects to Lace, initializes providers, delegates to LeaderboardAPI.
 */
export class BrowserLeaderboardManager {
  readonly #deploymentsSubject = new BehaviorSubject<Array<BehaviorSubject<LeaderboardDeployment>>>([]);
  #initializedProviders: Promise<LeaderboardProviders> | undefined;

  constructor(private readonly logger: Logger) {}

  readonly deployments$: Observable<Array<Observable<LeaderboardDeployment>>> = this.#deploymentsSubject;

  resolve(contractAddress?: ContractAddress): Observable<LeaderboardDeployment> {
    const deployments = this.#deploymentsSubject.value;
    const existing = deployments.find(
      (d) => d.value.status === 'deployed' && d.value.api.deployedContractAddress === contractAddress,
    );
    if (existing) return existing;

    const secretKey = this.getSecretKey();
    const deployment = new BehaviorSubject<LeaderboardDeployment>({ status: 'in-progress' });
    if (contractAddress) {
      void this.run(deployment, (providers) => LeaderboardAPI.join(providers, contractAddress, secretKey, this.logger));
    } else {
      void this.run(deployment, (providers) => LeaderboardAPI.deploy(providers, secretKey, this.logger));
    }
    this.#deploymentsSubject.next([...deployments, deployment]);
    return deployment;
  }

  // The player's secret key, kept in this browser's localStorage. Clearing site
  // data loses it, and with it the ability to prove ownership of past entries.
  private getSecretKey(): Uint8Array {
    const storageKey = 'midnight-leaderboard-secret';
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    }
    const secret = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(storageKey, btoa(String.fromCharCode(...secret)));
    return secret;
  }

  private getProviders(): Promise<LeaderboardProviders> {
    return this.#initializedProviders ?? (this.#initializedProviders = initializeProviders(this.logger));
  }

  private async run(
    deployment: BehaviorSubject<LeaderboardDeployment>,
    factory: (providers: LeaderboardProviders) => Promise<LeaderboardAPI>,
  ): Promise<void> {
    try {
      const providers = await this.getProviders();
      const api = await factory(providers);
      deployment.next({ status: 'deployed', api });
    } catch (error: unknown) {
      console.error('Contract operation failed:', error);
      let err: Error;
      if (error instanceof Error) {
        err = error;
      } else if (typeof error === 'string') {
        err = new Error(error);
      } else {
        err = new Error(JSON.stringify(error) || 'Unknown error during contract operation');
      }
      deployment.next({ status: 'failed', error: err });
    }
  }
}

// ── Provider initialization ────────────────────────────────────────────

const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

/** How long a built transaction stays valid, in seconds (Midnight.js 5 `config.ttlSeconds`). */
const TX_TTL_SECONDS = 3600;

const initializeProviders = async (logger: Logger): Promise<LeaderboardProviders> => {
  const networkId = (import.meta.env.VITE_NETWORK_ID ?? 'preprod') as NetworkId;
  setNetworkId(networkId);

  const connectedAPI = await connectToWallet(logger, networkId);
  const config = await connectedAPI.getConfiguration();
  if (!config.proverServerUri) throw new Error('Lace did not provide a proof server URI.');
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  // The keys, ZKIR and integrity manifest are served from this site's root
  // (see publicDir in vite.config.ts).
  const zkConfigProvider = new FetchZkConfigProvider<LeaderboardCircuitKeys>(window.location.origin, {
    fetchFunc: fetch.bind(window),
  });

  return {
    privateStateProvider: inMemoryPrivateStateProvider<'leaderboardPrivateState', LeaderboardPrivateState>(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri, zkConfigProvider),
    // The provider's default WebSocket is isomorphic-ws's Node export, which
    // its browser build lacks, so pass the browser's own.
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
      WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
    ),
    // Midnight.js 5 providers are tagged with the ledger eras they serve. Lace
    // works with Ledger 9 transactions; these wrappers lift the Ledger 9-only
    // implementations into the tagged interfaces.
    walletProvider: createLedger9WalletProvider({
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey as ledger.CoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey as ledger.EncPublicKey,
      balanceTx: async (tx: LedgerTransaction<'Unbound', 'v9'>): Promise<ledger.FinalizedTransaction> => {
        const received = await connectedAPI.balanceUnsealedTransaction(toHex(tx.serialize()));
        return ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(received.tx));
      },
    }),
    midnightProvider: createLedger9MidnightProvider(
      async (tx: LedgerTransaction<'Finalized', 'v9'>): Promise<ledger.TransactionId> => {
        const serialized = tx.serialize();
        await connectedAPI.submitTransaction(toHex(serialized));
        return ledger.Transaction.deserialize('signature', 'proof', 'binding', serialized).identifiers()[0];
      },
    ),
    config: { networkId, ttlSeconds: TX_TTL_SECONDS },
  };
};

// ── Wallet detection ───────────────────────────────────────────────────

const getFirstCompatibleWallet = (): InitialAPI | undefined => {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet && typeof wallet === 'object' && 'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

const connectToWallet = (logger: Logger, networkId: string): Promise<ConnectedAPI> =>
  firstValueFrom(
    interval(100).pipe(
      map(() => getFirstCompatibleWallet()),
      filter((api): api is InitialAPI => !!api),
      take(1),
      timeout({ first: 3_000, with: () => throwError(() => new Error('Could not find Midnight Lace wallet.')) }),
      concatMap(async (initialAPI) => {
        logger.info({ name: initialAPI.name, version: initialAPI.apiVersion }, 'Connecting to wallet');
        return initialAPI.connect(networkId);
      }),
      timeout({ first: 5_000, with: () => throwError(() => new Error('Lace wallet failed to respond.')) }),
      catchError((error) => throwError(() => (error instanceof Error ? error : new Error('Wallet not authorized')))),
    ),
  );
