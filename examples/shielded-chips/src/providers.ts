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

// Returns the providers in an object which can be created for each user's individual tests
import {
  createMidnightProvider,
  createWalletProvider,
  type MidnightProviders,
  type VersionedContractState,
} from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';
import { type ChipsImpureCircuits, type RouletteImpureCircuits } from '../contract/index.js';

// The set of callable circuit ids across BOTH contracts, derived from each
// compiled contract's generated types. This tracks whatever circuits the two
// .compact files export, so it never needs editing when circuits change.
export type ShieldedChipsCircuits =
  | keyof ChipsImpureCircuits<unknown>
  | keyof RouletteImpureCircuits<unknown>;

export type ShieldedChipsProviders = MidnightProviders<any>;

// How long a built transaction stays valid, in seconds (Midnight.js 5's
// `config.ttlSeconds`).
const TX_TTL_SECONDS = Number(process.env['MIDNIGHT_TX_TTL_SECONDS'] ?? 3600);

// Build one provider set per (wallet, contract). The zkConfigPath must point at
// a single managed/<contract>/ directory because NodeZkConfigProvider resolves
// keys at `<directory>/keys/<circuitId>.{prover,verifier}`. `storeSuffix` keeps
// each set's private-state store separate: several are built in the same
// millisecond, so a timestamp alone would collide.
export function buildProviders(
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
  storeSuffix = 'shielded-chips',
): ShieldedChipsProviders {
  const zkConfigProvider = new NodeZkConfigProvider<ShieldedChipsCircuits>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: `${storeSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // this password has requirements (capital/special chars >= 3)
      privateStoragePasswordProvider: () => 'ShieldedChips-Test-Password',
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
    walletProvider: createWalletProvider(wallet),
    midnightProvider: createMidnightProvider((tx) => wallet.submitTx(tx)),
    config: { networkId: config.networkId, ttlSeconds: TX_TTL_SECONDS },
  };
}

/**
 * The public ledger state of a contract read with queryContractState, for the
 * compiled `ledger()` to decode. Midnight.js 5 tags a contract state with the
 * ledger era that wrote it; every contract here is deployed on ledger 9.
 */
export function ledgerState(state: VersionedContractState | null) {
  if (state?.version !== 'v9') throw new Error('expected a ledger 9 contract state');
  return state.state.data;
}
