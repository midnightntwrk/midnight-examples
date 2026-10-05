// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// FungibleToken end-to-end: deploy two tokens (owned by deployer / trader),
// transfer, and indexer-verify the exact balance deltas. Translated from
// compact-end-2-end/dapps/fungible-token/src/main.ts. Only the deployer submits
// txs and pays fees; trader is an address-only participant.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { participantAddress, startFundedWallet } from '../harness.js';
import { addressBytes, stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import {
  bytesToHex,
  callCircuit,
  decodeLedger,
  deployFresh,
  loadContract,
  readLedger,
  type DeployResult,
  type LoadedContract,
} from '../contracts.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'fungible-token',
  'managed',
  'FungibleToken',
);

const TOKEN_A_SUPPLY = 1_000_000n;
const TOKEN_B_SUPPLY = 1_000_000n;
const TRANSFER_AMOUNT = 10_000n;

interface FungibleTokenLedger {
  balances: {
    lookup: (k: Uint8Array) => bigint;
    member: (k: Uint8Array) => boolean;
  };
}

describe(`fungible-token (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let deployerAddr: Uint8Array;
  let traderAddr: Uint8Array;
  let tokenA: DeployResult;
  let tokenB: DeployResult;

  beforeAll(async () => {
    loaded = await loadContract('ft/fungible-token', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    deployerAddr = addressBytes(deployer);
    traderAddr = participantAddress('trader', 1, config);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'ft/token', config);
    logger.info(`deployer=${bytesToHex(deployerAddr)} trader=${bytesToHex(traderAddr)}`);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  it('deploys token_a (deployer) and token_b (trader) with the full supply each', async () => {
    tokenA = await deployFresh(providers, loaded.compiledContract, 'ft/token-a', [
      deployerAddr,
      TOKEN_A_SUPPLY,
    ]);
    tokenB = await deployFresh(providers, loaded.compiledContract, 'ft/token-b', [
      traderAddr,
      TOKEN_B_SUPPLY,
    ]);
    logger.info(`token_a=${tokenA.contractAddress} token_b=${tokenB.contractAddress}`);

    const a0 = await readLedger<FungibleTokenLedger>(providers, tokenA.contractAddress, loaded.module);
    const b0 = await readLedger<FungibleTokenLedger>(providers, tokenB.contractAddress, loaded.module);
    expect(a0.balances.lookup(deployerAddr)).toBe(TOKEN_A_SUPPLY);
    expect(b0.balances.lookup(traderAddr)).toBe(TOKEN_B_SUPPLY);
  });

  it('transfers token_a deployer → trader and applies on-chain', async () => {
    const xfer = await callCircuit(tokenA.deployed, 'transfer', [
      deployerAddr,
      traderAddr,
      TRANSFER_AMOUNT,
    ]);
    expect(String(xfer.status)).toBe('SucceedEntirely');

    // Fast check straight from the node's post-call state.
    const post = decodeLedger<FungibleTokenLedger>(loaded.module, xfer.nextContractState);
    expect(post.balances.lookup(deployerAddr)).toBe(TOKEN_A_SUPPLY - TRANSFER_AMOUNT);
    expect(post.balances.member(traderAddr) ? post.balances.lookup(traderAddr) : 0n).toBe(
      TRANSFER_AMOUNT,
    );
  });

  it('indexer reflects the post-transfer balances', async () => {
    const a = await readLedger<FungibleTokenLedger>(providers, tokenA.contractAddress, loaded.module);
    const b = await readLedger<FungibleTokenLedger>(providers, tokenB.contractAddress, loaded.module);
    const aTrader = a.balances.member(traderAddr) ? a.balances.lookup(traderAddr) : 0n;
    expect(a.balances.lookup(deployerAddr)).toBe(TOKEN_A_SUPPLY - TRANSFER_AMOUNT);
    expect(aTrader).toBe(TRANSFER_AMOUNT);
    expect(b.balances.lookup(traderAddr)).toBe(TOKEN_B_SUPPLY);
  });
});
