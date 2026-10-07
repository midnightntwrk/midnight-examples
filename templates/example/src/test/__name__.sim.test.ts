// This file is part of example-__name__.
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

// In-memory tests: the compiled contract runs with compact-runtime, with no
// network and no proofs. `yarn compile:fast && yarn test:sim` runs them in
// seconds; put contract logic, every guard and the privacy invariants here,
// and keep the devnet suite (__name__.test.ts) for the end-to-end flow.
// `yarn new:example __name__ --derive` (repo root) fills the @generated-stub
// regions from the compiled contract; once you edit a region it is left alone.

import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from '@midnight-ntwrk/example-sim';
import { Contract, ledger } from '../../contract/managed/__name__/contract/index.js';
__SIM_WITNESS_IMPORT__

const deploy = () =>
  Sim.deploy({
    contract: new Contract(__SIM_WITNESSES__),
    ledger,
    // @generated-stub begin private-state sha=0
    privateState: __INITIAL_PRIVATE_STATE__,
    // @generated-stub end private-state
    // @generated-stub begin constructor-args sha=0
    // @generated-stub end constructor-args
  });

// Everything above is generated boilerplate. Your tests begin here.
//
//   sim.call('circuit', ...args)        one transaction; returns { result, ledger }
//   sim.as(coinPublicKeyHex)            later calls come from another wallet
//   sim.privateState = ...              swap the private state (another user)
//   expectRejects(() => sim.call(...), 'assert message')   every guard

describe('__Title__ (in memory)', () => {
  it('deploys', () => {
    expect(deploy().ledger()).toBeDefined();
  });

  // @generated-stub begin circuits sha=0
  // @generated-stub end circuits

  // @generated-stub begin privacy sha=0
  // SPEC.md → Privacy invariants: one entry per "never on chain" line.
  it('keeps secrets out of public state', () => {
    assertNotInPublicState(deploy().ledger(), {
      // TODO: secretName: bytes,
    });
  });
  // @generated-stub end privacy
});
