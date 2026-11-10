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

// TypeScript implementation of the leaderboard's two witnesses, plus each
// player's private state. Each witness receives a WitnessContext and returns a
// tuple [nextPrivateState, returnValue].
//
// This file also runs in the browser (the UI imports it), so it must not import
// any `node:*` module.
import { type Ledger } from './managed/leaderboard/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';

/**
 * The private state each player keeps in their own private-state store.
 * `localSecretKey` hands the secret key to the circuit, which uses it only as a
 * private proof input: it is never written on chain. The prover does see it, so
 * prove with the wallet or a proof server you run yourself, not a public one.
 * On chain, an entry stores `ownerCommitment(secretKey)`, so the same key is
 * what later proves ownership.
 */
export type LeaderboardPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createLeaderboardPrivateState = (secretKey: Uint8Array): LeaderboardPrivateState => ({
  secretKey,
});

// The name for the next `submitScore(score, true)` call. It is not part of the
// private state because it changes with every submission; the API sets it just
// before the call. Names are UTF-8, truncated to 32 bytes and zero-padded.
let customName = new Uint8Array(32);

export const setCustomName = (name: string): void => {
  customName = new Uint8Array(32);
  customName.set(new TextEncoder().encode(name).slice(0, 32));
};

// The property names, argument types and return-tuple shape match the generated
// `Witnesses` type in contract/managed/leaderboard/contract/index.d.ts.
// Bytes<32> maps to Uint8Array.
export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, LeaderboardPrivateState>): [LeaderboardPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  getCustomName: ({
    privateState,
  }: WitnessContext<Ledger, LeaderboardPrivateState>): [LeaderboardPrivateState, Uint8Array] => [
    privateState,
    customName,
  ],
};
