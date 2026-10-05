// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// kernel.caller: capture the calling identity (user vs contract). Translated
// from compact-end-2-end/dapps/caller/src/main.ts.
//
// COMPILE GAP (compactc 0.33.0-rc.2): Caller.compact:24 "operation caller
// undefined for ledger field type Kernel" — kernel.caller has not shipped. The
// suite SKIPS with a banner until it lands; the flow below then runs unchanged.
// When it does, caller_a becomes a funded submitter (fund its seed).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { addressBytes, stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders } from '../providers.js';
import { artifactExists, callCircuit, deployFresh, loadContract, readLedger } from '../contracts.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'caller',
  'managed',
);
const CALLER_MANAGED = path.join(MANAGED, 'Caller');
const PROXY_MANAGED = path.join(MANAGED, 'Proxy');

interface CallerValue {
  is_some: boolean;
  value: { is_left: boolean; left: Uint8Array; right: Uint8Array };
}
interface CallerLedger {
  last_caller: CallerValue;
}

const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const contractAddressBytes = (addr: string): Uint8Array => {
  const b = Buffer.from(addr.replace(/^0x/, ''), 'hex');
  if (b.length !== 32) throw new Error(`invalid contract address length: ${addr}`);
  return new Uint8Array(b);
};

const present = artifactExists(CALLER_MANAGED) && artifactExists(PROXY_MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === caller: not compiled (compactc 0.33.0-rc.2 lacks kernel.caller).' +
      '\n            Runs once kernel.caller ships upstream.\n',
  );
}

describe.skipIf(!present)(`caller (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let callerA: WalletCtx;
  let caller: Awaited<ReturnType<typeof loadContract>>;
  let proxy: Awaited<ReturnType<typeof loadContract>>;

  beforeAll(async () => {
    caller = await loadContract('caller/caller', CALLER_MANAGED);
    proxy = await loadContract('caller/proxy', PROXY_MANAGED);
    [deployer, callerA] = await Promise.all([
      startFundedWallet('deployer', 0, config, logger, syncTimeoutMs),
      startFundedWallet('caller_a', 1, config, logger, syncTimeoutMs),
    ]);
  });

  afterAll(async () => {
    await Promise.allSettled([
      deployer ? stopWallet(deployer, logger) : Promise.resolve(),
      callerA ? stopWallet(callerA, logger) : Promise.resolve(),
    ]);
  });

  it('capture() records the calling user (Either right = UserAddress)', async () => {
    const providers = await createProviders(callerA, caller.zkConfigPath, 'caller/caller_a', config);
    const inst = await deployFresh(providers, caller.compiledContract, 'caller/caller_a', []);
    await callCircuit(inst.deployed, 'capture', []);
    const led = await readLedger<CallerLedger>(providers, inst.contractAddress, caller.module);
    expect(led.last_caller.is_some).toBe(true);
    expect(led.last_caller.value.is_left).toBe(false);
    expect(bytesEq(led.last_caller.value.right, addressBytes(callerA))).toBe(true);
  });

  it('proxy.forward() records the contract-as-caller (Either left = ContractAddress)', async () => {
    const callerProviders = await createProviders(deployer, caller.zkConfigPath, 'caller/proxy-caller', config);
    const callerInst = await deployFresh(callerProviders, caller.compiledContract, 'caller/proxy-caller', []);
    const proxyProviders = await createProviders(deployer, proxy.zkConfigPath, 'caller/proxy', config);
    const proxyInst = await deployFresh(proxyProviders, proxy.compiledContract, 'caller/proxy', [
      callerInst.contractAddress,
    ]);
    await callCircuit(proxyInst.deployed, 'forward', []);
    const led = await readLedger<CallerLedger>(callerProviders, callerInst.contractAddress, caller.module);
    expect(led.last_caller.is_some).toBe(true);
    expect(led.last_caller.value.is_left).toBe(true);
    expect(bytesEq(led.last_caller.value.left, contractAddressBytes(proxyInst.contractAddress))).toBe(true);
  });
});
