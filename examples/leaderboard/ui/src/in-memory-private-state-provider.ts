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

// In-memory private state provider for the browser: private state per contract
// address (`forContract`) and signing keys, for the lifetime of the page.
// Export and import are not supported. The player's secret key itself is kept
// in localStorage by BrowserLeaderboardManager, so a page reload rebuilds this
// state from it.

import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import type { ContractPrivateStates, PrivateStateId, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';

export const inMemoryPrivateStateProvider = <PSI extends PrivateStateId, PS = unknown>(): PrivateStateProvider<PSI, PS> => {
  const states = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  const unsupported = (method: string) => async (): Promise<never> => {
    throw new Error(`${method} is not supported by the in-memory provider`);
  };

  const forContract = (address: ContractAddress): ContractPrivateStates<PSI, PS> => {
    // The same checks the persistent provider makes: 32 bytes of hex,
    // compared in lower case.
    assertIsContractAddress(address);
    const contractAddress = address.toLowerCase();
    const scoped = (): Map<PSI, PS> => {
      let m = states.get(contractAddress);
      if (m === undefined) states.set(contractAddress, (m = new Map()));
      return m;
    };
    return {
      contractAddress,
      async set(id: PSI, state: PS) {
        scoped().set(id, state);
      },
      async get(id: PSI) {
        return states.get(contractAddress)?.get(id) ?? null;
      },
      async remove(id: PSI) {
        states.get(contractAddress)?.delete(id);
      },
      async clear() {
        states.delete(contractAddress);
      },
      exportPrivateStates: unsupported('exportPrivateStates'),
      importPrivateStates: unsupported('importPrivateStates'),
    };
  };

  return {
    forContract,
    async clearAll() {
      states.clear();
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
      signingKeys.set(address, signingKey);
    },
    async getSigningKey(address: ContractAddress) {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address: ContractAddress) {
      signingKeys.delete(address);
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },
    exportSigningKeys: unsupported('exportSigningKeys'),
    importSigningKeys: unsupported('importSigningKeys'),
  };
};
