// This file is part of example-lottery.
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
import { type Ledger, type Witnesses } from './managed/lottery/contract/index.js';

// The caller's private state, kept by the DApp's private-state provider on this
// device and never sent to the network.
// - `secretKey` identifies the caller: the contract hashes it with one purpose
//   for the organizer key and another for the player key.
// - `seed` is the organizer's draw seed, committed to at deployment. A player's
//   seed is never used. Losing the organizer's seed means the draw can never
//   happen, so a UI must keep this state across sessions.
export type LotteryPrivateState = {
  readonly secretKey: Uint8Array;
  readonly seed: Uint8Array;
};

// `crypto.getRandomValues`, not `node:crypto`: this file also runs in the
// browser (docs/compact-gotchas.md).
const random32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

// Fresh random secrets by default. Tests pass them explicitly when they need a
// known organizer or a reproducible draw.
export const createLotteryPrivateState = (
  secretKey: Uint8Array = random32(),
  seed: Uint8Array = random32(),
): LotteryPrivateState => ({ secretKey, seed });

// A fresh random nonce for `buyTicket`, one per ticket.
export const randomNonce = random32;

// Typed against the compiler-generated `Witnesses<PS>`, so a renamed witness or
// a wrong return type in lottery.compact fails `tsc` here. Each returns
// [nextPrivateState, value]; none of them changes the state.
export const witnesses: Witnesses<LotteryPrivateState> = {
  secretKey: ({ privateState }) => [privateState, privateState.secretKey],
  seed: ({ privateState }) => [privateState, privateState.seed],
  // `draw` checks q * divisor + r == value and r < divisor, so this is only
  // trusted to be fast, not honest.
  divMod: ({ privateState }, value, divisor) => [privateState, [value / divisor, value % divisor]],
};

export type { Ledger, Witnesses };
