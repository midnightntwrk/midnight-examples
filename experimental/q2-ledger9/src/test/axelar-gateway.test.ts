// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// AxelarGateway: dispatch command types through execute(), which re-enters the
// gateway on its own address. Translated from
// compact-end-2-end/dapps/axelar-gateway/src/main.ts (condensed to the deploy →
// deployToken → mintToken → replay-guard core).
//
// COMPILE GAP (compactc 0.33.0-rc.2): AxelarGateway.compact:204 self-interface
// member/circuit name collision. SKIPS with a banner until self-interfaces land.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { addressBytes, stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import { artifactExists, callCircuit, deployFresh, loadContract, readLedger, type DeployResult, type LoadedContract } from '../contracts.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'axelar-gateway',
  'managed',
  'AxelarGateway',
);

const CMD = { deployToken: 0n, mintToken: 1n } as const;
const MINT_AMOUNT = 1_000n;
const MINT_LIMIT = 1_000_000n;
const ZERO32 = new Uint8Array(32);

const b32 = (label: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).slice(0, 32));
  return out;
};
const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

interface MapLike<V> {
  lookup: (k: Uint8Array) => V;
  member: (k: Uint8Array) => boolean;
}
interface GatewayLedger {
  command_executed: MapLike<boolean>;
  token_addresses: MapLike<Uint8Array>;
  token_mint_amounts: MapLike<bigint>;
  balances: MapLike<bigint>;
}

const present = artifactExists(MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === axelar-gateway: not compiled (compactc 0.33.0-rc.2 rejects the' +
      '\n            self-interface member/circuit name collision). Runs once' +
      '\n            self-interfaces ship upstream.\n',
  );
}

// execute() takes the superset of every command's params; unused slots are zero.
const executeArgs = (
  gatewayAddress: string,
  c: {
    commandId: Uint8Array;
    commandType: bigint;
    name?: Uint8Array;
    symbol?: Uint8Array;
    decimals?: bigint;
    cap?: bigint;
    tokenAddress?: Uint8Array;
    mintLimit?: bigint;
    account?: Uint8Array;
    amount?: bigint;
  },
): readonly unknown[] => [
  gatewayAddress,
  c.commandId,
  c.commandType,
  c.name ?? ZERO32,
  c.symbol ?? ZERO32,
  c.decimals ?? 0n,
  c.cap ?? 0n,
  c.tokenAddress ?? ZERO32,
  c.mintLimit ?? 0n,
  c.account ?? ZERO32,
  c.amount ?? 0n,
  ZERO32, // salt
  ZERO32, // sourceChain
  ZERO32, // sourceAddress
  ZERO32, // contractAddress
  ZERO32, // payloadHash
  ZERO32, // sourceTxHash
  0n, // sourceEventIndex
  ZERO32, // newOperatorsHash
];

describe.skipIf(!present)(`axelar-gateway (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let gw: DeployResult;
  let deployerAddr: Uint8Array;
  const symbol = b32('AXL');
  const tokenAddr = b32('axl-token-address');

  beforeAll(async () => {
    loaded = await loadContract('axelar-gateway/main', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    deployerAddr = addressBytes(deployer);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'axelar-gateway', config);
    gw = await deployFresh(providers, loaded.compiledContract, 'axelar-gateway/main', [
      b32('operators-epoch-1'),
    ]);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  const ledgerNow = () => readLedger<GatewayLedger>(providers, gw.contractAddress, loaded.module);

  it('execute(deployToken) registers the token address', async () => {
    await callCircuit(gw.deployed, 'execute', executeArgs(gw.contractAddress, {
      commandId: b32('cmd-deploy-token'),
      commandType: CMD.deployToken,
      name: b32('Axelar Wrapped Token'),
      symbol,
      decimals: 6n,
      tokenAddress: tokenAddr,
      mintLimit: MINT_LIMIT,
    }));
    const led = await ledgerNow();
    expect(bytesEq(led.token_addresses.lookup(symbol), tokenAddr)).toBe(true);
  });

  it('execute(mintToken) mints to the deployer; a replay is rejected', async () => {
    const mintCmd = b32('cmd-mint-token');
    const mint = () =>
      callCircuit(gw.deployed, 'execute', executeArgs(gw.contractAddress, {
        commandId: mintCmd,
        commandType: CMD.mintToken,
        symbol,
        account: deployerAddr,
        amount: MINT_AMOUNT,
      }));
    await mint();
    const led = await ledgerNow();
    expect(led.balances.lookup(deployerAddr)).toBe(MINT_AMOUNT);
    expect(led.token_mint_amounts.lookup(symbol)).toBe(MINT_AMOUNT);

    await expect(mint()).rejects.toThrow();
    expect((await ledgerNow()).balances.lookup(deployerAddr)).toBe(MINT_AMOUNT);
  });
});
