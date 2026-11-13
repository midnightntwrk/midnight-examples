// This file is part of example-voting.
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
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForNightThenDust } from '../wallet.js';
import pino from 'pino';

import { getConfig } from '../config.js';
import { buildProviders, ledgerState, type VotingCircuits as VotingCircuitId, type VotingProviders } from '../providers.js';
import { createVotingPrivateState, Vote, type VotingPrivateState } from '../../contract/witnesses.js';
import {
  ballotNullifier,
  ballotSalt,
  newAdminEncryptionKeys,
  newSecretKey,
  openBallot,
  passes,
  proposalIdFromLabel,
  sealBallot,
  ballotRecipients,
  voteInstance,
  voterKey,
} from '../crypto.js';
import {
  CompiledVotingContract,
  Contract,
  ledger,
  zkConfigPath,
  // @generated-stub begin contract-imports sha=e3b0c44298fc
  // @generated-stub end contract-imports
} from '../../contract/index.js';
// Shielded-coin helpers, imported here when a circuit takes a coin or a
// second contract mints them. See ./coins.ts.
// @generated-stub begin coin-imports sha=e3b0c44298fc
// @generated-stub end coin-imports

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// One wallet pays for the admin and the first voter; a second wallet (Bob)
// casts at the same time to show concurrent casts don't conflict. Each
// identity is its own private-state id holding its own secret.
const PRIVATE_STATE_ID = 'AdminVotingState';
const VOTER_IDS = ['Voter0State', 'Voter1State', 'Voter2State'] as const;

const PID = proposalIdFromLabel(`dry-run-${Date.now()}`.slice(0, 32));
const ADMIN_SK = newSecretKey();
const ADMIN_ENC = newAdminEncryptionKeys();
const VOTER_SKS = VOTER_IDS.map(() => newSecretKey());
const VOTES = [Vote.YES, Vote.NO, Vote.YES];
const now = () => Math.floor(Date.now() / 1000);

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`Voting Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: VotingProviders;
  let bobWallet: MidnightWalletProvider;
  let bobProviders: VotingProviders;
  let contractAddress: ContractAddress;
  // @generated-stub begin contract-providers sha=e3b0c44298fc
  // @generated-stub end contract-providers

  const config = getConfig();
  const isRemote = network !== 'local';
  // A wallet syncs from genesis the first time (saved state makes later runs
  // fast): the timeout covers that first sync.
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 120 * 60_000 : 10 * 60_000),
  );

  // Reads the contract's public ledger state.
  // @generated-stub begin ledger-fields sha=16e693b5954c
  // Public ledger fields:
  //   adminPk: Bytes<32>
  //   proposalId: Bytes<32>
  //   phase: Phase
  //   voters: MerkleTree
  //   voterKeys: Set
  //   adminEncKeys: Set
  //   enrolled: Counter
  //   castCount: Counter
  //   ballots: Map<Bytes<32>, Bytes<32>>
  //   encBallots: Map<Bytes<32>, Opaque<"Uint8Array">>
  //   counted: Set
  //   yes: Counter
  //   no: Counter
  //   abstain: Counter
  //   deadline: Uint<0..18446744073709551615>
  //   countingEnds: Uint<0..18446744073709551615>
  //   closedEarly: Boolean
  // @generated-stub end ledger-fields
  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(ledgerState(state));
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
    // the shared Alice wallet from the repo-root .env.<network>, which syncs
    // from genesis (over an hour on preprod). Pass a role name
    // (e.g. resolveWallet(network, 'BOB')) if your suite needs more than one.
    const setup = resolveWallet(network);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret);
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

    const bob = resolveWallet(network, 'BOB');
    bobWallet = await MidnightWalletProvider.build(logger, envConfig, bob.secret);
    await bobWallet.start();
    await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);
    if (isRemote) {
      await waitForNightThenDust(logger, bobWallet.wallet, bobWallet.unshieldedKeystore, envConfig, config.faucet, {
        label: bob.role,
      });
    }
    bobProviders = buildProviders(bobWallet, zkConfigPath, config);
    // @generated-stub begin contract-providers-init sha=e3b0c44298fc
    // @generated-stub end contract-providers-init
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallets...');
      await wallet.stop();
    }
    if (bobWallet) await bobWallet.stop();
  });

  // ---------------------------------------------------------------------------
  // Everything above is generated boilerplate. Your tests begin here.
  // ---------------------------------------------------------------------------

  // Other contracts first: a test-only token usually feeds this contract's
  // constructor (its token color, say).
  // @generated-stub begin contract-deploys sha=e3b0c44298fc
  // @generated-stub end contract-deploys

  it('deploys the contract', async () => {
    const deployed: DeployedContract<Contract> = await deployContract(providers, {
      compiledContract: CompiledVotingContract,
      privateStateId: PRIVATE_STATE_ID,
      // @generated-stub begin private-state sha=9caba161e1f9
      initialPrivateState: createVotingPrivateState(ADMIN_SK),
      // @generated-stub end private-state
      // @generated-stub begin constructor-args sha=aa127cfd9002
      args: [PID],
      // @generated-stub end constructor-args
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);
  });

  // @generated-stub begin circuits sha=dac65cc91f11
  // Every circuit is exercised by the flow below.
  // @generated-stub end circuits

  const call = (p: VotingProviders, privateStateId: string, circuitId: VotingCircuitId, args: unknown[]) =>
    submitCallTx(p, {
      compiledContract: CompiledVotingContract,
      contractAddress,
      privateStateId,
      circuitId,
      args,
    } as never);

  const setPrivateState = (p: VotingProviders, id: string, state: VotingPrivateState) =>
    p.privateStateProvider.forContract(contractAddress).set(id, state);

  it('enrols three voters, publishes the admin key and opens voting', async () => {
    for (const sk of VOTER_SKS) await call(providers, PRIVATE_STATE_ID, 'enrol', [voterKey(sk)]);
    await call(providers, PRIVATE_STATE_ID, 'addAdminKey', [ADMIN_ENC.publicKey]);
    await call(providers, PRIVATE_STATE_ID, 'open', [BigInt(now() + 30 * 60)]);
    const l = await queryLedger();
    expect(l.enrolled).toBe(3n);
    expect(l.adminEncKeys.member(ADMIN_ENC.publicKey)).toBe(true);
  });

  const V = () => voteInstance(PID, contractAddress);

  const castFor = async (p: VotingProviders, i: number) => {
    await setPrivateState(p, VOTER_IDS[i], createVotingPrivateState(VOTER_SKS[i], VOTES[i]));
    const blob = sealBallot({ vote: VOTES[i], salt: ballotSalt(VOTER_SKS[i], V()) }, [ADMIN_ENC.publicKey], V());
    await call(p, VOTER_IDS[i], 'cast', [blob, ballotRecipients([ADMIN_ENC.publicKey])]);
  };

  it('accepts two casts submitted at the same time from different wallets', async () => {
    await Promise.all([castFor(providers, 0), castFor(bobProviders, 1)]);
    const l = await queryLedger();
    expect(l.castCount).toBe(2n);
    expect(l.ballots.member(ballotNullifier(VOTER_SKS[0], V()))).toBe(true);
    expect(l.ballots.member(ballotNullifier(VOTER_SKS[1], V()))).toBe(true);
  });

  it('rejects a second cast by the same voter', async () => {
    await expect(castFor(providers, 0)).rejects.toThrow();
  });

  it('refuses an early close while a voter is outstanding, then closes once all have cast', async () => {
    await expect(call(providers, PRIVATE_STATE_ID, 'closeEarly', [])).rejects.toThrow();
    await castFor(providers, 2);
    await call(providers, PRIVATE_STATE_ID, 'closeEarly', []);
    expect((await queryLedger()).closedEarly).toBe(true);
  });

  it('lets the admin decrypt and count every ballot', async () => {
    for (const [n, blob] of (await queryLedger()).encBallots) {
      const opening = openBallot(blob, ADMIN_ENC.secretKey, V());
      expect(opening).toBeDefined();
      await call(providers, PRIVATE_STATE_ID, 'count', [n, opening!.vote, opening!.salt]);
    }
    const l = await queryLedger();
    expect([l.yes, l.no, l.abstain]).toEqual([2n, 1n, 0n]);
    expect(l.counted.size()).toBe(3n);
    expect(passes(l)).toBe(true);
  });

});
