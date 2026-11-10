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

// Network tests for the leaderboard: the same flow as leaderboard.sim.test.ts,
// through the LeaderboardAPI, with real wallets, proofs and an indexer.
//
//   npm run test:preview    (or test:preprod, test:custom)
//
// The local devnet in compose.yml does not run Ledger 9 yet, so `test:local`
// fails at the first contract call. Remote runs read their wallet seeds from
// the repo-root .env.<network>.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';
import { firstValueFrom } from 'rxjs';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForNightThenDust } from '../wallet.js';
import { buildProviders } from '../providers.js';
import { LeaderboardAPI, decodeLedger, type LeaderboardProviders } from '../../api/index.js';
import { pureCircuits, type Ledger } from '../../contract/index.js';
import { assertNotInPublicState } from './sim.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
);

/**
 * Build, start, sync, and (on a remote network) fund-gate one wallet.
 *
 * Locally, ALICE and BOB are the genesis-funded seeds 01 and 02. Remotely they
 * are the shared wallets in the repo-root .env.<network>.
 */
async function buildWallet(
  role: 'ALICE' | 'BOB',
  env: EnvironmentConfiguration,
  faucet: string,
): Promise<MidnightWalletProvider> {
  const setup = resolveWallet(network, role);
  const w = await MidnightWalletProvider.build(logger, env, setup.secret);
  await w.start();
  await syncWallet(logger, w.wallet, syncTimeoutMs);
  if (isRemote) {
    // Synced is not funded: a wallet with no DUST fails its first submit.
    await waitForNightThenDust(logger, w.wallet, w.unshieldedKeystore, env, faucet, {
      label: setup.role,
    });
  }
  return w;
}

const nameBytes = (name: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(name).slice(0, 32));
  return out;
};

describe(`Leaderboard contract (${network})`, () => {
  let aliceWallet: MidnightWalletProvider;
  let bobWallet: MidnightWalletProvider;
  let aliceProviders: LeaderboardProviders;
  let bobProviders: LeaderboardProviders;
  let alice: LeaderboardAPI;
  let bob: LeaderboardAPI;

  const config = getConfig();
  const aliceSk = new Uint8Array(randomBytes(32));
  const bobSk = new Uint8Array(randomBytes(32));

  async function queryLedger(): Promise<Ledger> {
    const read = await aliceProviders.publicDataProvider.queryContractState(alice.deployedContractAddress);
    expect(read).not.toBeNull();
    return decodeLedger(read!);
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

    aliceWallet = await buildWallet('ALICE', envConfig, config.faucet);
    bobWallet = await buildWallet('BOB', envConfig, config.faucet);
    aliceProviders = buildProviders(aliceWallet, config);
    bobProviders = buildProviders(bobWallet, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (aliceWallet) await aliceWallet.stop();
    if (bobWallet) await bobWallet.stop();
  });

  it('Alice deploys an empty leaderboard', async () => {
    alice = await LeaderboardAPI.deploy(aliceProviders, aliceSk, logger);
    logger.info(`Leaderboard deployed at: ${alice.deployedContractAddress}`);
    const l = await queryLedger();
    expect(l.scores.isEmpty()).toBe(true);
    expect(l.nextId).toBe(0n);
  });

  it('Alice submits a score under a custom name', async () => {
    await alice.submitScore(420, 'alice');
    const entry = (await queryLedger()).scores.lookup(1n);
    expect(entry.score).toBe(420n);
    expect(entry.displayName).toEqual(nameBytes('alice'));
    expect(entry.ownerHash).toEqual(pureCircuits.ownerCommitment(aliceSk));
  });

  it('Bob joins and submits an anonymous score', async () => {
    bob = await LeaderboardAPI.join(bobProviders, alice.deployedContractAddress, bobSk, logger);
    await bob.submitScore(900);
    const l = await queryLedger();
    expect(l.nextId).toBe(2n);
    expect(l.scores.lookup(2n).ownerHash).toEqual(pureCircuits.ownerCommitment(bobSk));
  });

  it('state$ lists the entries, highest score first', async () => {
    const state = await firstValueFrom(bob.state$);
    expect(state.entryCount).toBe(2);
    expect(state.entries.map((e) => [e.id, e.score])).toEqual([
      [2, 900],
      [1, 420],
    ]);
    expect(state.entries[1].displayName).toBe('alice');
  });

  it('Alice proves she owns entry 1', async () => {
    await expect(alice.verifyOwnership(1)).resolves.toBeUndefined();
  });

  it("Bob cannot prove he owns Alice's entry, or an entry that does not exist", async () => {
    await expect(bob.verifyOwnership(1)).rejects.toThrow(/not the owner/);
    await expect(bob.verifyOwnership(99)).rejects.toThrow(/entry not found/);
  });

  it('no secret key appears in public state', async () => {
    assertNotInPublicState(await queryLedger(), { aliceSecretKey: aliceSk, bobSecretKey: bobSk });
  });
});
