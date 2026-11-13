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

// Types shared by the leaderboard API and its callers.
//
// This file also runs in the browser (the UI imports it), so it must not import
// any `node:*` module.
import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Contract, type ImpureCircuits, type LeaderboardPrivateState } from '../contract/index.js';

export const leaderboardPrivateStateKey = 'leaderboardPrivateState';
export type PrivateStateId = typeof leaderboardPrivateStateKey;

/** The circuits that need proofs, from the compiled contract's generated types. */
export type LeaderboardCircuitKeys = keyof ImpureCircuits<LeaderboardPrivateState>;

export type LeaderboardProviders = MidnightProviders<LeaderboardCircuitKeys, PrivateStateId, LeaderboardPrivateState>;

export type LeaderboardContract = Contract<LeaderboardPrivateState>;
export type DeployedLeaderboardContract = FoundContract<LeaderboardContract>;

export interface LeaderboardEntry {
  readonly id: number;
  readonly score: number;
  readonly displayName: string;
  readonly ownerHash: string;
}

export interface LeaderboardDerivedState {
  readonly entryCount: number;
  readonly entries: LeaderboardEntry[];
}
