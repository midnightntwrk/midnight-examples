// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// recover-secp: in-circuit ECDSA public-key recovery. recoverAddress(h, sig)
// recovers the signer's point from a digest + recoverable signature, then
// derives its Ethereum address.
//
// COMPILE GAP: the recover API (Secp256k1EcdsaSignatureWithRecovery +
// secp256k1EcdsaRecover) was removed between compactc 0.33.0-rc.0 and rc.1
// (compact#610) and is STILL ABSENT in 0.33.0-rc.2 — unbound even with
// --feature-zkir-v3. This suite SKIPS with a banner until the API is restored,
// at which point the recover → address flow below runs unchanged.
//
// NOTE: the JS shape of Secp256k1EcdsaSignatureWithRecovery cannot be confirmed
// while the type is unbound; { r, s, recovery } (bigint scalars + parity) is the
// expected shape (mirrors @noble's recovered signature). Confirm against the
// generated bindings once the API returns.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { secp256k1 } from '@noble/curves/secp256k1.js';

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
  'recover-secp',
  'managed',
  'RecoverSecp',
);

interface RecoverLedger {
  recoveredAddr: Uint8Array;
}

const be = (b: Uint8Array): bigint => {
  let acc = 0n;
  for (const byte of b) acc = (acc << 8n) | BigInt(byte);
  return acc;
};

const present = artifactExists(MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === recover-secp: secp256k1EcdsaRecover /' +
      '\n            Secp256k1EcdsaSignatureWithRecovery removed since rc.1, still' +
      '\n            absent in 0.33.0-rc.2 (unbound even with --feature-zkir-v3).' +
      '\n            Runs once the recover API is restored upstream.\n',
  );
}

describe.skipIf(!present)(`recover-secp (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let inst: DeployResult;

  const kp = generateAttesterKeypair();
  const expectedAddr = kp.ethAddress; // 20 bytes
  // A fixed 32-byte digest, signed with recovery.
  const digest = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 3) & 0xff);
  const rec = secp256k1.sign(digest, kp.privateKey, { prehash: false, format: 'recovered' });
  const sig = { r: be(rec.slice(1, 33)), s: be(rec.slice(33, 65)), recovery: BigInt(rec[0]!) };

  beforeAll(async () => {
    loaded = await loadContract('recover-secp', MANAGED);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'recover-secp', config);
    inst = await deployFresh(providers, loaded.compiledContract, 'recover-secp', []);
    logger.info(`deployed at ${inst.contractAddress}; expected eth addr=${bytesToHex(expectedAddr)}`);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  it('recoverAddress(h, sig) recovers the signer and derives its Ethereum address', async () => {
    const res = await callCircuit(inst.deployed, 'recoverAddress', [digest, sig]);
    expect(String(res.status)).toBe('SucceedEntirely');
    expect(bytesToHex(res.result as Uint8Array)).toBe(bytesToHex(expectedAddr));
    const post = decodeLedger<RecoverLedger>(loaded.module, res.nextContractState);
    expect(bytesToHex(post.recoveredAddr)).toBe(bytesToHex(expectedAddr));
  });

  it('indexer reflects the recovered Ethereum address', async () => {
    const led = await readLedger<RecoverLedger>(providers, inst.contractAddress, loaded.module);
    expect(bytesToHex(led.recoveredAddr)).toBe(bytesToHex(expectedAddr));
  });
});
