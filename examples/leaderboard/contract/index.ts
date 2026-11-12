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

// Exports the compiled contract. `npm run compile` writes the compiler output to
// contract/managed/leaderboard. Unlike the other examples, this directory is
// committed: the Vercel build has no Compact compiler, so the UI build copies
// the keys and ZKIR from here (see ../vercel.json).
//
// This file also runs in the browser (the API layer imports it), so it must not
// import any `node:*` module. Node code that needs the absolute key directory
// uses `zkConfigPath` from src/providers.ts.
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { Contract } from './managed/leaderboard/contract/index.js';
import { witnesses } from './witnesses.js';

export {
  Contract,
  ledger,
  pureCircuits,
  type Witnesses,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
} from './managed/leaderboard/contract/index.js';
export {
  witnesses,
  setCustomName,
  createLeaderboardPrivateState,
  type LeaderboardPrivateState,
} from './witnesses.js';

export const CompiledLeaderboardContract = CompiledContract.make('leaderboard', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('./managed/leaderboard'),
);
