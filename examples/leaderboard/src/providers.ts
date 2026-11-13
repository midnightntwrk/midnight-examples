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

// Returns the providers in an object which can be created for each user's individual tests
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { fileURLToPath } from 'node:url';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';
import { type LeaderboardCircuitKeys, type LeaderboardProviders } from '../api/index.js';

/** The compiler output directory, which holds the circuits' keys and ZKIR. */
export const zkConfigPath = fileURLToPath(new URL('../contract/managed/leaderboard', import.meta.url));

// How long a built transaction stays valid, in seconds (Midnight.js 5's
// `config.ttlSeconds`).
const TX_TTL_SECONDS = Number(process.env['MIDNIGHT_TX_TTL_SECONDS'] ?? 3600);

// Build one provider set per wallet. The random suffix keeps each set's
// private-state store separate: several sets are built in the same
// millisecond, so a timestamp alone would collide.
export function buildProviders(wallet: MidnightWalletProvider, config: NetworkConfig): LeaderboardProviders {
  const zkConfigProvider = new NodeZkConfigProvider<LeaderboardCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: `leaderboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // this password has requirements (capital/special chars >= 3)
      privateStoragePasswordProvider: () => 'Leaderboard-Test-Password',
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
    // Midnight.js 5 providers are tagged with the ledger eras they serve. The
    // wallet is ledger 9 only; these lift it into the tagged interfaces.
    walletProvider: createLedger9WalletProvider(wallet),
    midnightProvider: createLedger9MidnightProvider((tx) => wallet.submitTx(tx)),
    config: { networkId: config.networkId, ttlSeconds: TX_TTL_SECONDS },
  };
}
