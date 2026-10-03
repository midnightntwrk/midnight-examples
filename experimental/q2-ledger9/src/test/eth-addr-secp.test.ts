// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// prove-eth-addr-secp: the provable secp256k1 → Ethereum address circuit.
// storeEthereumAddress(pk) computes keccak256 over the point's runtime encoding
// (via the stdlib secp256k1EthereumAddress), stores the 20-byte address in the
// lastAddr ledger cell, and returns it. Provable since LFDT-Minokawa/compact#612
// ("Handle alignment for curve points in ZKIR v3"). Compiled with
// --feature-zkir-v3 (see scripts/compile.mts).
//
// pk is a plain circuit ARGUMENT (Secp256k1Point = { x, y, identity }, coords
// big-endian), so this dapp is witness-free. Only the deployer submits + pays.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import {
  artifactExists,
  bytesToHex,
  callCircuit,
  decodeLedger,
  deployFresh,
  loadContract,
  readLedger,
  type DeployResult,
  type LoadedContract,
} from '../contracts.js';
import { generateAttesterKeypair } from '../attestation-fixture.js';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'eth-addr-secp',
  'managed',
  'ProveEthAddrSecp',
);

interface ProveEthAddrLedger {
  lastAddr: Uint8Array;
}

// 64-byte uncompressed pubkey (big-endian x||y) → Secp256k1Point.
function pubkeyToPoint(publicKey: Uint8Array): { x: bigint; y: bigint; identity: boolean } {
  if (publicKey.length !== 64) {
    throw new Error(`expected 64-byte uncompressed pubkey, got ${publicKey.length}`);
  }
  const be = (b: Uint8Array): bigint => {
    let acc = 0n;
    for (const byte of b) acc = (acc << 8n) | BigInt(byte);
    return acc;
  };
  return { x: be(publicKey.subarray(0, 32)), y: be(publicKey.subarray(32, 64)), identity: false };
}

const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const present = artifactExists(MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === eth-addr-secp: not compiled. Build with' +
      "\n            `COMPACTC=/path/to/compactc-0.33.0-rc.2/compactc yarn compile`" +
      '\n            (needs --feature-zkir-v3, wired in scripts/compile.mts).\n',
  );
}

describe.skipIf(!present)(`eth-addr-secp (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let inst: DeployResult;
  // A fresh secp256k1 keypair; ethAddress = keccak256(pubkey)[12:] — exactly
  // what the in-circuit secp256k1EthereumAddress must reproduce.
  const kp = generateAttesterKeypair();
  const expectedAddr = kp.ethAddress; // 20 bytes

  beforeAll(async () => {
    loaded = await loadContract('eth-addr-secp/prove', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'eth-addr-secp', config);
    inst = await deployFresh(providers, loaded.compiledContract, 'eth-addr-secp', []);
    logger.info(`deployed at ${inst.contractAddress}; expected eth addr=${bytesToHex(expectedAddr)}`);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  it('lastAddr starts as the zero address', async () => {
    const led = await readLedger<ProveEthAddrLedger>(providers, inst.contractAddress, loaded.module);
    expect(bytesEq(led.lastAddr, new Uint8Array(20))).toBe(true);
  });

  it('storeEthereumAddress(pk) returns and stores keccak256(pubkey)[12:]', async () => {
    const point = pubkeyToPoint(kp.publicKey);
    const res = await callCircuit(inst.deployed, 'storeEthereumAddress', [point]);
    expect(String(res.status)).toBe('SucceedEntirely');

    // Circuit return value is the 20-byte address.
    const returned = res.result as Uint8Array;
    expect(bytesToHex(returned)).toBe(bytesToHex(expectedAddr));

    // Node post-call state agrees before the indexer catches up.
    const post = decodeLedger<ProveEthAddrLedger>(loaded.module, res.nextContractState);
    expect(bytesToHex(post.lastAddr)).toBe(bytesToHex(expectedAddr));
  });

  it('indexer reflects the stored Ethereum address', async () => {
    const led = await readLedger<ProveEthAddrLedger>(providers, inst.contractAddress, loaded.module);
    expect(bytesToHex(led.lastAddr)).toBe(bytesToHex(expectedAddr));
  });
});
