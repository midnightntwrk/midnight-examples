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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type PrivateBidProviders } from '../providers.js';
import { createPrivateBidPrivateState } from '../../contract/witnesses.js';
import {
  CompiledPrivateBidContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'AlicePrivateBidState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`Private Bid Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: PrivateBidProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // Reads the contract's public ledger state. Adapt the returned fields to your
  // own `ledger` declaration.
  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);

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
    // the shared Alice wallet from the repo-root .env.<network>, fast-syncing
    // from the reference bundle when a birthday is recorded. Pass a role name
    // (e.g. resolveWallet(network, 'BOB')) if your suite needs more than one.
    const setup = resolveWallet(network);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret, {
      fastSync: setup.fastSync,
    });
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      // Synced is not funded: a wallet with no DUST fails its first submit.
      await waitForNightThenDust(
        logger,
        wallet.wallet,
        wallet.unshieldedKeystore,
        envConfig,
        config.faucet,
        { label: setup.role },
      );
    }

    providers = buildProviders(wallet, zkConfigPath, config);
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

  // The flow from the docs guide, in order: each test builds on the ledger
  // state the previous one left behind, sharing one deployment and one bidder.
  const MINIMUM_BID = 100n;
  const BID = 250n;

  // Calls a circuit of the deployed contract. The private state stored under
  // PRIVATE_STATE_ID at deploy time feeds the localSecretKey witness.
  const call = (circuitId: 'placeBid' | 'revealBid', amount: bigint) =>
    (submitCallTx<Contract, 'placeBid' | 'revealBid'>)(providers, {
      compiledContract: CompiledPrivateBidContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId,
      args: [amount],
    });

  it('deploys the contract with a public minimum bid', async () => {
    // The secret key is generated on this machine and stays in private state.
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledPrivateBidContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createPrivateBidPrivateState(),
      args: [MINIMUM_BID],
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);

    const state = await queryLedger();
    expect(state.minimumBid).toEqual(MINIMUM_BID);
    expect(state.bidCommitments.isEmpty()).toBe(true);
    expect(state.revealedBids.isEmpty()).toBe(true);
  });

  it('rejects a bid below the minimum', async () => {
    // The assert fails while the circuit runs locally, so no proof is made and
    // nothing reaches the chain.
    await expect(call('placeBid', 50n)).rejects.toThrow(/Bid is below the minimum/);
    expect((await queryLedger()).bidCommitments.isEmpty()).toBe(true);
  });

  it('places a bid without putting the amount on the ledger', async () => {
    await call('placeBid', BID);

    const state = await queryLedger();
    expect(state.bidCommitments.size()).toEqual(1n);
    expect(state.revealedBids.isEmpty()).toBe(true);

    // All that is public is two 32-byte hashes: the bidder key and the
    // commitment. The amount (250) is in neither.
    const [[bidder, commitment]] = [...state.bidCommitments];
    logger.info(`Bidder key:  ${Buffer.from(bidder).toString('hex')}`);
    logger.info(`Commitment:  ${Buffer.from(commitment).toString('hex')}`);
    expect(bidder).toHaveLength(32);
    expect(commitment).toHaveLength(32);
  });

  it('rejects a second bid from the same bidder', async () => {
    // Same secret key -> same bidder key -> the member() check fails. This is
    // also what keeps the deterministic salt safe: one commitment per bidder.
    await expect(call('placeBid', BID + 1n)).rejects.toThrow(/already placed a bid/);
    expect((await queryLedger()).bidCommitments.size()).toEqual(1n);
  });

  it('rejects a reveal that does not match the commitment', async () => {
    await expect(call('revealBid', 300n)).rejects.toThrow(
      /Amount does not match the committed bid/,
    );
    expect((await queryLedger()).revealedBids.isEmpty()).toBe(true);
  });

  it('reveals the bid when the bidder chooses to', async () => {
    await call('revealBid', BID);

    const state = await queryLedger();
    const [[bidder, amount]] = [...state.revealedBids];
    expect(amount).toEqual(BID);
    // The revealed amount is filed under the same bidder key as the commitment.
    expect(state.bidCommitments.member(bidder)).toBe(true);
  });
});
