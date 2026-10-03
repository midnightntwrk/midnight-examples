// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Events end-to-end: deploy, transfer (emits UnshieldedSpend + UnshieldedReceive
// via `log`), then verify BOTH read paths — ledger-state balance deltas AND the
// contract-log events over the indexer GraphQL API. Translated from
// compact-end-2-end/dapps/events/src/main.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { participantAddress, startFundedWallet } from '../harness.js';
import { addressBytes, stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import { callCircuit, deployFresh, loadContract, readLedger, type DeployResult, type LoadedContract } from '../contracts.js';
import { queryContractLogEvents, sameContractAddress } from '../events.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'events',
  'managed',
  'Events',
);

const SUPPLY = 1_000_000n;
const TRANSFER_AMOUNT = 10_000n;

interface EventsLedger {
  balances: { lookup: (k: Uint8Array) => bigint; member: (k: Uint8Array) => boolean };
}

describe(`events (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let deployerAddr: Uint8Array;
  let traderAddr: Uint8Array;
  let token: DeployResult;
  let transferTxHash: string;

  beforeAll(async () => {
    loaded = await loadContract('ev/events', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    deployerAddr = addressBytes(deployer);
    traderAddr = participantAddress('trader', 1, config);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'ev/token', config);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  it('deploys the token and transfers deployer → trader', async () => {
    token = await deployFresh(providers, loaded.compiledContract, 'ev/token', [deployerAddr, SUPPLY]);
    const xfer = await callCircuit(token.deployed, 'transfer', [
      deployerAddr,
      traderAddr,
      TRANSFER_AMOUNT,
    ]);
    transferTxHash = xfer.txHash;

    const led = await readLedger<EventsLedger>(providers, token.contractAddress, loaded.module);
    const traderBal = led.balances.member(traderAddr) ? led.balances.lookup(traderAddr) : 0n;
    expect(led.balances.lookup(deployerAddr)).toBe(SUPPLY - TRANSFER_AMOUNT);
    expect(traderBal).toBe(TRANSFER_AMOUNT);
  });

  it('emits UnshieldedSpend + UnshieldedReceive contract-log events', async () => {
    const events = await queryContractLogEvents(config.indexer, token.contractAddress, transferTxHash);
    const ours = events.filter((e) => sameContractAddress(e.contractAddress, token.contractAddress));
    logger.info(`contract-log events on transfer tx: ${ours.length}`);
    expect(ours.length).toBe(2);
  });
});
