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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
// @if monorepo
import { MidnightWalletProvider, startWallet } from '../wallet.js';
// @endif
// @if standalone
import { MidnightWalletProvider, startWallet } from '@midnightntwrk/mnkit-wallet';
// @endif
import pino from 'pino';

import { getConfig } from '../config.js';
import { buildProviders, ledgerState, type __Name__Providers } from '../providers.js';
__PRIVATE_STATE_IMPORT__
import {
  Compiled__Name__Contract,
  Contract,
  ledger,
  zkConfigPath,
  // @generated-stub begin contract-imports sha=0
  // @generated-stub end contract-imports
} from '../../contract/index.js';
// Shielded-coin helpers, imported here when a circuit takes a coin or a
// @if monorepo
// second contract mints them. See ./coins.ts.
// @endif
// @if standalone
// second contract mints them. See @midnightntwrk/mnkit-coins and its README.
// @endif
// @generated-stub begin coin-imports sha=0
// @generated-stub end coin-imports

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'Alice__Name__State';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`__Title__ Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: __Name__Providers;
  let contractAddress: ContractAddress;
  // @generated-stub begin contract-providers sha=0
  // @generated-stub end contract-providers

  const config = getConfig();
  const isRemote = network !== 'local';
  // A wallet syncs from genesis the first time (saved state makes later runs
  // fast): the timeout covers that first sync.
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 120 * 60_000 : 10 * 60_000),
  );

  // Reads the contract's public ledger state.
  // @generated-stub begin ledger-fields sha=0
  // @generated-stub end ledger-fields
  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(ledgerState(state));
  }

  beforeAll(async () => {
    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    // Locally this is the genesis-funded Alice seed. On a remote network it is
    // @if monorepo
    // the shared Alice wallet from the repo-root .env.<network>, which syncs
    // from genesis (over an hour on preprod).
    // @endif
    // @if standalone
    // the Alice wallet from .env.<network> (MIDNIGHT_<NETWORK>_SEED). It syncs
    // from genesis the first time; saved state makes later runs fast.
    // @endif
    // startWallet builds, starts and syncs it, and on a remote network waits
    // until it is funded. A second wallet (a tipper, a bidder) is two lines:
    //   bob = await startWallet(logger, envConfig, { network, role: 'BOB', faucet: config.faucet, syncTimeoutMs });
    //   bobProviders = buildProviders(bob, zkConfigPath, config);
    wallet = await startWallet(logger, envConfig, { network, faucet: config.faucet, syncTimeoutMs });

    providers = buildProviders(wallet, zkConfigPath, config);
    // @generated-stub begin contract-providers-init sha=0
    // @generated-stub end contract-providers-init
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // Everything above is generated boilerplate. Your tests begin here.
  // ---------------------------------------------------------------------------

  // Other contracts first: a test-only token usually feeds this contract's
  // constructor (its token color, say).
  // @generated-stub begin contract-deploys sha=0
  // @generated-stub end contract-deploys

  it('deploys the contract', async () => {
    const deployed: DeployedContract<Contract> = await deployContract(providers, {
      compiledContract: Compiled__Name__Contract,
      privateStateId: PRIVATE_STATE_ID,
      // @generated-stub begin private-state sha=0
      initialPrivateState: __INITIAL_PRIVATE_STATE__,
      // @generated-stub end private-state
      // @generated-stub begin constructor-args sha=0
      // @generated-stub end constructor-args
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);
  });

  // @if monorepo
  // One it.todo per impure circuit, written by `npm run new:example -- __name__ --derive`.
  // @endif
  // @if standalone
  // One it.todo per impure circuit, written by `npx mnkit derive`.
  // @endif
  // @generated-stub begin circuits sha=0
  // @generated-stub end circuits

  // TODO: add circuit-interaction tests. `submitCallTx` and `queryLedger` are
  // imported/defined for you. Example shape:
  //
  // it('does the thing', async () => {
  //   await submitCallTx(providers, {
  //     compiledContract: Compiled__Name__Contract,
  //     contractAddress,
  //     privateStateId: PRIVATE_STATE_ID,
  //     circuitId: 'yourCircuit',
  //     args: [/* circuit args */],
  //   });
  //   const state = await queryLedger();
  //   expect(state.someField).toEqual(/* expected */);
  // });
  void submitCallTx;
  void queryLedger;
});
