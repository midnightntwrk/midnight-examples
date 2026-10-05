// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Self-recursion: drive a contract back into itself by passing its own address
// as a circuit argument. Translated from
// compact-end-2-end/dapps/self-recursion/src/main.ts.
//
// COMPILE GAP (compactc 0.33.0-rc.2): SelfRecursion.compact:28 "cycle involving
// type SelfRecursionSelf" — a contract interface referencing its own type is
// rejected. The suite SKIPS with a banner until self-interface types land; the
// flow below then runs unchanged.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import { artifactExists, callCircuit, deployFresh, loadContract, readLedger, type DeployResult, type LoadedContract } from '../contracts.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'self-recursion',
  'managed',
  'SelfRecursion',
);

const SPIRAL_DEPTH = 2n; // spiral(self, 2) → 3 increments (n=2, 1, 0)

interface SelfRecursionLedger {
  pongs: bigint;
  spirals: bigint;
}

const present = artifactExists(MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === self-recursion: not compiled (compactc 0.33.0-rc.2 rejects the' +
      '\n            self-referential SelfRecursionSelf interface type). Runs once' +
      '\n            self-interface types ship upstream.\n',
  );
}

describe.skipIf(!present)(`self-recursion (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let inst: DeployResult;

  beforeAll(async () => {
    loaded = await loadContract('self-recursion/main', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'self-recursion', config);
    inst = await deployFresh(providers, loaded.compiledContract, 'self-recursion/main', []);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  const ledgerNow = () =>
    readLedger<SelfRecursionLedger>(providers, inst.contractAddress, loaded.module);

  it('ping(self) → pong() (different-circuit self-call)', async () => {
    await callCircuit(inst.deployed, 'ping', [inst.contractAddress]);
    expect((await ledgerNow()).pongs).toBe(1n);
  });

  it('pong() direct (same circuit, plain call)', async () => {
    await callCircuit(inst.deployed, 'pong', []);
    expect((await ledgerNow()).pongs).toBe(2n);
  });

  it('spiral(self, n) → bounded same-circuit recursion', async () => {
    await callCircuit(inst.deployed, 'spiral', [inst.contractAddress, SPIRAL_DEPTH]);
    expect((await ledgerNow()).spirals).toBe(SPIRAL_DEPTH + 1n);
  });
});
