// This file is part of example-voting.
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

// TypeScript implementations of the contract's witnesses — the off-chain logic
// Compact cannot express. Each witness receives a WitnessContext and returns a
// tuple [nextPrivateState, returnValue].
import { type Ledger, type Witnesses, Vote } from './managed/voting/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';

// One secret per participant: the admin's secret (whose hash is adminPk), or a
// voter's secret (whose hash is the enrolled voter key, and from which the
// ballot nullifier and salt are derived). A voter also sets the vote they are
// about to cast; it is never written anywhere but this private state.
export type VotingPrivateState = {
  readonly secretKey: Uint8Array;
  readonly vote?: Vote;
};

export const createVotingPrivateState = (secretKey: Uint8Array, vote?: Vote): VotingPrivateState => {
  if (secretKey.length !== 32) throw new Error('secretKey must be 32 bytes');
  return vote === undefined ? { secretKey } : { secretKey, vote };
};

/** The same private state with the vote to cast set. */
export const withVote = (ps: VotingPrivateState, vote: Vote): VotingPrivateState => ({ ...ps, vote });

export { Vote };

// @generated-stub begin witnesses sha=6bbcf2017939
export const witnesses: Witnesses<VotingPrivateState> = {
  secretKey: ({ privateState }) => [privateState, privateState.secretKey],
  // The path is looked up in the voters tree of the ledger state the circuit
  // runs against, so it always matches the root `cast` checks. The tree is
  // frozen once voting opens, so the path can't go stale before the cast lands.
  voterPath: ({ privateState, ledger }, pk) => {
    const path = ledger.voters.findPathForLeaf(pk);
    if (path === undefined) throw new Error('This voter key is not enrolled');
    return [privateState, path];
  },
  vote: ({ privateState }) => {
    if (privateState.vote === undefined) throw new Error('No vote set in private state');
    return [privateState, privateState.vote];
  },
};
// @generated-stub end witnesses

export type { Ledger, Witnesses, WitnessContext };
