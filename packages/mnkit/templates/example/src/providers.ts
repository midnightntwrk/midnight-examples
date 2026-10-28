// This file is part of example-__name__.
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

// Returns the providers in an object which can be created for each user's individual tests
import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from '@midnightntwrk/mnkit-wallet';
import { type NetworkConfig } from './config.js';
import { type ImpureCircuits } from '../contract/index.js';

// The set of callable circuit ids, derived from the compiled contract's
// generated types. This tracks whatever circuits your .compact exports, so you
// never have to edit this file when you add, remove, or rename a circuit.
export type __Name__Circuits = keyof ImpureCircuits<unknown>;

export type __Name__Providers = MidnightProviders<any>;

/**
 * Where a provider set keeps private state and the contracts' signing keys.
 * `dbName` is the LevelDB directory, `storeName` the store inside it, and
 * `password` encrypts both (at least 16 characters, with 3 of: upper case,
 * lower case, digits, symbols).
 */
export type PrivateStateStore = {
  dbName: string;
  storeName: string;
  password: string;
};

/**
 * The providers for one contract. Without `privateState` the store is a
 * throwaway one for tests: a fresh name each call, under ./midnight-level-db.
 * scripts/deploy.ts passes a persistent store instead.
 */
export function buildProviders(
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
  privateState?: PrivateStateStore,
): __Name__Providers {
  const zkConfigProvider = new NodeZkConfigProvider<__Name__Circuits>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      ...(privateState ? { midnightDbName: privateState.dbName } : {}),
      // The random suffix keeps each provider set's private-state store separate
      // when a test builds several sets (wallets, contracts) in the same millisecond.
      privateStateStoreName:
        privateState?.storeName ?? `__name__-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // this password has requirements (capital/special chars >= 3)
      privateStoragePasswordProvider: () => privateState?.password ?? '__Name__-Test-Password',
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      config.proofServer,
      zkConfigProvider,
    ),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
