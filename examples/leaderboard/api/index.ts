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

// Shared business logic for the leaderboard contract.
//
// Platform-agnostic: it runs in the browser (with Lace's providers) and in Node
// (with the test suite's wallet providers). Each platform builds its own
// providers and passes them in.
//
// This file must not import any `node:*` module.
import { type ContractAddress, ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { type ContractStateRead } from '@midnight-ntwrk/midnight-js-types';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { map, type Observable } from 'rxjs';
import {
  CompiledLeaderboardContract,
  createLeaderboardPrivateState,
  ledger,
  setCustomName,
  type Ledger,
} from '../contract/index.js';
import {
  type DeployedLeaderboardContract,
  type LeaderboardDerivedState,
  type LeaderboardEntry,
  type LeaderboardProviders,
  leaderboardPrivateStateKey,
} from './common-types.js';
import * as utils from './utils/index.js';

/**
 * Decodes a contract state read from the indexer into the leaderboard's public
 * ledger. Midnight.js 5 returns the serialized state tagged with the ledger era
 * that wrote it. The contract is deployed on Ledger 9, so only a Ledger 9
 * decoder is given.
 */
export const decodeLedger = (read: ContractStateRead): Ledger => {
  if (read.contractState.era !== 'v9') throw new Error('expected a Ledger 9 contract state');
  return ledger(read.contractState.deserialize({ v9: ContractState }).data);
};

/** Turns the public ledger into display rows, highest score first. */
export const deriveState = (ledgerState: Ledger): LeaderboardDerivedState => {
  const entries: LeaderboardEntry[] = [];
  for (const [key, entry] of ledgerState.scores) {
    entries.push({
      id: Number(key),
      score: Number(entry.score),
      displayName: utils.decodeDisplayName(entry.displayName, Number(key), Number(entry.score)),
      ownerHash: utils.toHex(entry.ownerHash),
    });
  }
  entries.sort((a, b) => b.score - a.score);
  return { entryCount: Number(ledgerState.nextId), entries };
};

/**
 * API for a deployed leaderboard contract.
 *
 * Created with `LeaderboardAPI.deploy()` (a new leaderboard) or
 * `LeaderboardAPI.join()` (an existing one).
 */
export class LeaderboardAPI {
  private constructor(
    public readonly deployedContract: DeployedLeaderboardContract,
    providers: LeaderboardProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.state$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(map(({ value }) => deriveState(decodeLedger(value))));
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<LeaderboardDerivedState>;

  /** Submits a score. With a custom name, the getCustomName witness supplies it. */
  async submitScore(score: number, customName?: string): Promise<void> {
    if (customName) setCustomName(customName);
    this.logger?.info({ score, customName: !!customName }, 'Submitting score');
    await this.deployedContract.callTx.submitScore(BigInt(score), !!customName);
  }

  /** Proves ownership of an entry. The proof reveals nothing about the caller's key. */
  async verifyOwnership(entryId: number): Promise<void> {
    this.logger?.info({ entryId }, 'Proving ownership');
    await this.deployedContract.callTx.verifyOwnership(BigInt(entryId));
  }

  /** Deploys a new leaderboard contract. */
  static async deploy(providers: LeaderboardProviders, secretKey: Uint8Array, logger?: Logger): Promise<LeaderboardAPI> {
    const deployedContract = await deployContract(providers, {
      compiledContract: CompiledLeaderboardContract,
      privateStateId: leaderboardPrivateStateKey,
      initialPrivateState: createLeaderboardPrivateState(secretKey),
    });
    logger?.info({ address: deployedContract.deployTxData.public.contractAddress }, 'Deployed leaderboard');
    return new LeaderboardAPI(deployedContract, providers, logger);
  }

  /** Joins an existing leaderboard contract. */
  static async join(
    providers: LeaderboardProviders,
    contractAddress: ContractAddress,
    secretKey: Uint8Array,
    logger?: Logger,
  ): Promise<LeaderboardAPI> {
    const deployedContract = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: CompiledLeaderboardContract,
      privateStateId: leaderboardPrivateStateKey,
      initialPrivateState: createLeaderboardPrivateState(secretKey),
    });
    logger?.info({ address: contractAddress }, 'Joined leaderboard');
    return new LeaderboardAPI(deployedContract, providers, logger);
  }
}

export * as utils from './utils/index.js';
export * from './common-types.js';
