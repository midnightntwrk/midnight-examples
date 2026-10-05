// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// verify-sequential-secp: instantiate secp256k1EcdsaVerify multiple times in a
// single circuit over one digest `d` with independent (signature, pubkey)
// witness pairs. `two(d)` verifies pairs 0+1; `three(d)` verifies pairs 0+1+2.
// Each success increments the `n` ledger counter. Compiled with
// --feature-zkir-v3 (see scripts/compile.mts); both circuits are provable.
//
// Witness values are read from a mutable ref so the negative case can swap in a
// bad signature (mirrors the usdcx attestation-ref pattern). Witness-typed:
// pk* → Secp256k1Point { x, y, identity }; sig* → { r, s } (bigint scalars),
// coords/scalars big-endian. Only the deployer submits + pays.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { secp256k1 } from '@noble/curves/secp256k1.js';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import {
  artifactExists,
  callCircuit,
  decodeLedger,
  deployFresh,
  loadContract,
  readLedger,
  type DeployResult,
  type LoadedContract,
  type Witnesses,
} from '../contracts.js';
import { generateAttesterKeypair } from '../attestation-fixture.js';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const MANAGED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'verify-sequential-secp',
  'managed',
  'VerifySequentialSecp',
);

interface Ledger {
  n: bigint;
}

type Point = { x: bigint; y: bigint; identity: boolean };
type Sig = { r: bigint; s: bigint };

const be = (b: Uint8Array): bigint => {
  let acc = 0n;
  for (const byte of b) acc = (acc << 8n) | BigInt(byte);
  return acc;
};
const pubkeyToPoint = (publicKey: Uint8Array): Point => {
  if (publicKey.length !== 64) throw new Error(`expected 64-byte pubkey, got ${publicKey.length}`);
  return { x: be(publicKey.subarray(0, 32)), y: be(publicKey.subarray(32, 64)), identity: false };
};
// Sign the 32-byte digest directly (it IS the message hash) → canonical low-s.
const signDigest = (digest: Uint8Array, privateKey: Uint8Array): Sig => {
  const sig = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  return { r: be(sig.slice(1, 33)), s: be(sig.slice(33, 65)) };
};

// A fixed 32-byte digest all signatures are produced over (arbitrary content —
// the circuit only checks each signature verifies against it).
const DIGEST = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff);

interface WitnessValues {
  points: [Point, Point, Point];
  sigs: [Sig, Sig, Sig];
}

const present = artifactExists(MANAGED);
if (!present) {
  console.log(
    '\n=== GAP === verify-sequential-secp: not compiled. Build with' +
      "\n            `COMPACTC=/path/to/compactc-0.33.0-rc.2/compactc yarn compile`" +
      '\n            (needs --feature-zkir-v3, wired in scripts/compile.mts).\n',
  );
}

describe.skipIf(!present)(`verify-sequential-secp (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let providers: Providers;
  let loaded: LoadedContract;
  let inst: DeployResult;

  // Three independent keypairs; sign the shared digest with each.
  const kp = [generateAttesterKeypair(), generateAttesterKeypair(), generateAttesterKeypair()];
  const valid: WitnessValues = {
    points: [pubkeyToPoint(kp[0]!.publicKey), pubkeyToPoint(kp[1]!.publicKey), pubkeyToPoint(kp[2]!.publicKey)],
    sigs: [signDigest(DIGEST, kp[0]!.privateKey), signDigest(DIGEST, kp[1]!.privateKey), signDigest(DIGEST, kp[2]!.privateKey)],
  };
  // Witness closures read from this ref, so a test can swap in bad values.
  const ref: { current: WitnessValues } = { current: valid };

  beforeAll(async () => {
    const w = (ctx: { privateState: unknown }, v: unknown): [unknown, unknown] => [ctx.privateState, v];
    const witnesses: Witnesses = {
      pk0: (ctx: { privateState: unknown }) => w(ctx, ref.current.points[0]),
      sig0: (ctx: { privateState: unknown }) => w(ctx, ref.current.sigs[0]),
      pk1: (ctx: { privateState: unknown }) => w(ctx, ref.current.points[1]),
      sig1: (ctx: { privateState: unknown }) => w(ctx, ref.current.sigs[1]),
      pk2: (ctx: { privateState: unknown }) => w(ctx, ref.current.points[2]),
      sig2: (ctx: { privateState: unknown }) => w(ctx, ref.current.sigs[2]),
    };
    loaded = await loadContract('verify-sequential-secp', MANAGED, witnesses);
    deployer = await startFundedWallet('deployer', 0, config, logger, syncTimeoutMs);
    providers = await createProviders(deployer, loaded.zkConfigPath, 'verify-sequential-secp', config);
    inst = await deployFresh(providers, loaded.compiledContract, 'verify-sequential-secp', []);
    logger.info(`deployed at ${inst.contractAddress}`);
  });

  afterAll(async () => {
    if (deployer) await stopWallet(deployer, logger);
  });

  const nNow = async (): Promise<bigint> =>
    (await readLedger<Ledger>(providers, inst.contractAddress, loaded.module)).n;

  it('starts with counter n = 0', async () => {
    expect(await nNow()).toBe(0n);
  });

  it('two(d): verifies two signatures over the digest and increments n', async () => {
    ref.current = valid;
    const res = await callCircuit(inst.deployed, 'two', [DIGEST]);
    expect(String(res.status)).toBe('SucceedEntirely');
    expect(decodeLedger<Ledger>(loaded.module, res.nextContractState).n).toBe(1n);
    expect(await nNow()).toBe(1n);
  });

  it('three(d): verifies three signatures over the digest and increments n', async () => {
    ref.current = valid;
    const res = await callCircuit(inst.deployed, 'three', [DIGEST]);
    expect(String(res.status)).toBe('SucceedEntirely');
    expect(await nNow()).toBe(2n);
  });

  it('rejects two(d) when a signature does not verify against its pubkey', async () => {
    // Tamper slot 0: keep pubkey 0 but supply a signature from a different key —
    // secp256k1EcdsaVerify fails, so the circuit's assert(..., "b0") aborts.
    const bad: WitnessValues = {
      points: valid.points,
      sigs: [signDigest(DIGEST, kp[1]!.privateKey), valid.sigs[1], valid.sigs[2]],
    };
    ref.current = bad;
    await expect(callCircuit(inst.deployed, 'two', [DIGEST])).rejects.toThrow(/b0/);
    // Counter unchanged by the rejected call.
    ref.current = valid;
    expect(await nNow()).toBe(2n);
  });
});
