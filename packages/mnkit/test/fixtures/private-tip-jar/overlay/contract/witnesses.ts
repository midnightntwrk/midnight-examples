// This file is part of example-private-tip-jar.
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

// TypeScript implementation of the tip jar's one witness, plus its private
// state. Each witness receives a WitnessContext and returns a tuple
// [nextPrivateState, returnValue].
//
// This file also runs in the browser (a generated UI imports it), so it must
// not import any `node:*` module.
import { type Ledger } from './managed/private-tip-jar/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

/**
 * The private state each party keeps for the tip jar, in their own local
 * private-state store. It never leaves the machine: the witness hands the key
 * to the circuit, which only uses it inside the proof.
 *
 * - The owner keeps the secret whose hash the constructor stored as `owner`.
 *   Losing it means losing the ability to withdraw: no circuit can rotate the
 *   `sealed` owner field.
 * - A tipper never calls `ownerSecretKey` (the `tip` circuit has no witness),
 *   so any value works. The tests give tippers a random one, which also lets
 *   them show that a non-owner's `withdraw` is rejected.
 *
 * Use a fresh, high-entropy 32-byte secret per jar. The same secret in two
 * jars produces the same public `owner` hash, linking them to one owner.
 */
export type PrivateTipJarPrivateState = {
  ownerSecretKey: Uint8Array;
};

export const createPrivateTipJarPrivateState = (
  ownerSecretKey: Uint8Array,
): PrivateTipJarPrivateState => ({ ownerSecretKey });

// The property names, argument types, and return-tuple shape match the
// generated `Witnesses` type in contract/managed/private-tip-jar/contract/index.d.ts.
// Bytes<32> maps to Uint8Array.
export const witnesses = {
  // Called by the constructor (to store `owner`) and by `withdraw` (to prove
  // the caller is the owner). The private state is returned unchanged: reading
  // the key does not consume or rotate it.
  ownerSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, PrivateTipJarPrivateState>): [
    PrivateTipJarPrivateState,
    Uint8Array,
  ] => [privateState, privateState.ownerSecretKey],
};
