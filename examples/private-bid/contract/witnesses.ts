// This file is part of example-private-bid.
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

// TypeScript implementation of the contract's one witness, `localSecretKey`.
// Witnesses run on the bidder's machine, never on chain; the circuit sees the
// returned value as private input and the compiler stops it from reaching the
// ledger unless the contract wraps it (or something derived from it) in
// disclose(). This contract only ever discloses hashes of the key.
import { randomBytes } from 'node:crypto';
import { type Witnesses } from './managed/private-bid/contract/index.js';

// The bidder's private state: kept by the DApp's private-state provider on
// this device and never sent to the network. The secret key is what identifies
// the bidder to the contract (through a hash bound to the contract address) and
// what derives the salt hiding their committed amount, so losing it means the
// bid can never be revealed.
export type PrivateBidPrivateState = {
  readonly secretKey: Uint8Array;
};

// 32 fresh random bytes per bidder by default. Tests pass a key explicitly when
// they need two distinct bidders or a reproducible one.
export const createPrivateBidPrivateState = (
  secretKey: Uint8Array = randomBytes(32),
): PrivateBidPrivateState => ({ secretKey });

// Typed against the compiler-generated `Witnesses<PS>`, so a renamed witness or
// a wrong return type in private-bid.compact fails `tsc` here instead of at
// runtime. A witness returns [nextPrivateState, value]; this one only reads.
export const witnesses: Witnesses<PrivateBidPrivateState> = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
};
