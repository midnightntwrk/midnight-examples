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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { type ContractAddress, encodeUserAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { firstValueFrom } from 'rxjs';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type LotteryProviders } from '../providers.js';
import { type LotteryPrivateState, createLotteryPrivateState, randomNonce } from '../../contract/witnesses.js';
import { LotteryState } from '../../contract/managed/lottery/contract/index.js';
import {
  CompiledLotteryContract,
  Contract,
  ledger,
  zkConfigPath,
  // @generated-stub begin contract-imports sha=e3b0c44298fc
  // @generated-stub end contract-imports
} from '../../contract/index.js';
// Shielded-coin helpers, imported here when a circuit takes a coin or a
// second contract mints them. See packages/coins/src/index.ts.
// @generated-stub begin coin-imports sha=e3b0c44298fc
// @generated-stub end coin-imports

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// One wallet pays every fee and every ticket. The contract tells the organizer
// and the players apart by their secret keys, so each identity is its own
// private state (the zk-loan pattern).
const PRIVATE_STATE_ID = 'OrganizerLotteryState';
const PLAYER_IDS = ['PlayerOneLotteryState', 'PlayerTwoLotteryState'] as const;
const PRICE = 1_000n;
const MAX = 3n;
// The NIGHT token type: the all-zero color.
const NIGHT = '0'.repeat(64);

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`Lottery Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: LotteryProviders;
  let contractAddress: ContractAddress;
  // @generated-stub begin contract-providers sha=e3b0c44298fc
  // @generated-stub end contract-providers

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // Reads the contract's public ledger state.
  // @generated-stub begin ledger-fields sha=4204bed4244e
  // Public ledger fields:
  //   organizer: Bytes<32>
  //   seedCommitment: Bytes<32>
  //   ticketPrice: Uint<0..18446744073709551615>
  //   maxTickets: Uint<0..65535>
  //   state: LotteryState
  //   tickets: Map<Uint<0..65535>, Bytes<32>>
  //   ticketCount: Counter
  //   pot: Uint<0..340282366920938463463374607431768211455>
  //   entropy: Bytes<32>
  //   winningTicket: Uint<0..65535>
  //   winner: Bytes<32>
  // @generated-stub end ledger-fields
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
    // @generated-stub begin contract-providers-init sha=e3b0c44298fc
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
  // @generated-stub begin contract-deploys sha=e3b0c44298fc
  // @generated-stub end contract-deploys

  // The wallet's unshielded NIGHT balance. Fees are paid in DUST, so NIGHT
  // moves only by ticket payments and the prize.
  async function night(): Promise<bigint> {
    const state = await firstValueFrom(wallet.wallet.state());
    const balances = (state.unshielded.balances ?? {}) as Record<string, bigint>;
    return BigInt(balances[NIGHT] ?? 0n);
  }

  // The wallet syncs a moment after a call finalizes: poll until the balance
  // reaches the expected value, or return the last one for a clear diff.
  async function waitForNight(expected: bigint, timeoutMs = 60_000): Promise<bigint> {
    const start = Date.now();
    let last = await night();
    while (last !== expected && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      last = await night();
    }
    return last;
  }

  async function setPrivateState(id: string, state: LotteryPrivateState): Promise<void> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(id, state);
  }

  async function call<K extends 'buyTicket' | 'closeSales' | 'draw' | 'claimPrize'>(
    privateStateId: string,
    circuitId: K,
    ...args: Parameters<Contract['impureCircuits'][K]> extends [unknown, ...infer A] ? A : never
  ) {
    const res = await (submitCallTx<Contract, K>)(providers, {
      compiledContract: CompiledLotteryContract,
      contractAddress,
      privateStateId,
      circuitId,
      args,
    } as never);
    expect(res.public.status).toEqual(SucceedEntirely);
    return res;
  }

  it('deploys the contract', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledLotteryContract,
      privateStateId: PRIVATE_STATE_ID,
      // @generated-stub begin private-state sha=29fc6a7a670f
      initialPrivateState: createLotteryPrivateState(undefined as never /* TODO secretKey */),
      // @generated-stub end private-state
      // @generated-stub begin constructor-args sha=1fcb6439d086
      args: [
        PRICE, // price: Uint<64>
        MAX, // max: Uint<16>
      ],
      // @generated-stub end constructor-args
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const l = await queryLedger();
    expect(l.state).toEqual(LotteryState.OPEN);
    expect(l.ticketPrice).toEqual(PRICE);
    expect(l.maxTickets).toEqual(MAX);
    expect(l.pot).toEqual(0n);
  });

  // @generated-stub begin circuits sha=f9b06a4313ed
  it('buyTicket: two players each pay the price in NIGHT for a ticket', async () => {
    for (const [i, id] of PLAYER_IDS.entries()) {
      await setPrivateState(id, createLotteryPrivateState());
      const before = await night();
      await call(id, 'buyTicket', randomNonce());
      expect(await waitForNight(before - PRICE)).toEqual(before - PRICE);

      const l = await queryLedger();
      expect(l.ticketCount).toEqual(BigInt(i + 1));
      expect(l.pot).toEqual(BigInt(i + 1) * PRICE);
    }
    const l = await queryLedger();
    expect(l.tickets.lookup(0n)).not.toEqual(l.tickets.lookup(1n));
  });

  it('buyTicket: rejects the organizer', async () => {
    await expect(call(PRIVATE_STATE_ID, 'buyTicket', randomNonce())).rejects.toThrow();
    expect((await queryLedger()).ticketCount).toEqual(2n);
  });

  it('closeSales: rejects a player, then the organizer closes', async () => {
    await expect(call(PLAYER_IDS[0], 'closeSales')).rejects.toThrow();
    await call(PRIVATE_STATE_ID, 'closeSales');
    expect((await queryLedger()).state).toEqual(LotteryState.CLOSED);
  });

  it('draw: the organizer draws one of the two tickets', async () => {
    await call(PRIVATE_STATE_ID, 'draw');
    const l = await queryLedger();
    expect(l.state).toEqual(LotteryState.DRAWN);
    expect(l.winningTicket).toBeLessThan(2n);
    expect(l.winner).toEqual(l.tickets.lookup(l.winningTicket));
    logger.info(`Ticket ${l.winningTicket} won`);
  });

  it('claimPrize: the loser is rejected, the winner is paid the whole pot', async () => {
    // Player i bought ticket i.
    const won = Number((await queryLedger()).winningTicket);
    const winner = PLAYER_IDS[won]!;
    const loser = PLAYER_IDS[1 - won]!;
    const to = { bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) };

    await expect(call(loser, 'claimPrize', to)).rejects.toThrow();

    const before = await night();
    await call(winner, 'claimPrize', to);
    expect(await waitForNight(before + 2n * PRICE)).toEqual(before + 2n * PRICE);

    const l = await queryLedger();
    expect(l.state).toEqual(LotteryState.PAID);
    expect(l.pot).toEqual(0n);
  });
  // @generated-stub end circuits
});
