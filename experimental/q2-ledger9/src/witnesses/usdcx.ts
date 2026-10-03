// This file is part of stagenet-q2 (adapted from example-usdcx/contracts/index.ts).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Witness wiring for BridgedUsdcMint (the only witnessed dapp). It has seven
// witnesses (messageBytes, attesterSig0/1, attesterPubkey0/1, mintAmount,
// messageNonce). midnight-js bakes witnesses in at build time, so we bake
// CLOSURES that read from a mutable "current attestation" ref; the test sets
// the ref immediately before each receiveAndMint call.

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import type {
  AssembledAttestation,
  RecoverableSignature,
} from '../attestation-fixture.js';
import { artifactExists, type Witnesses } from '../contracts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USDCX = path.resolve(HERE, '..', '..', 'contracts', 'usdcx');
// Built by `yarn compile` from contracts/usdcx/bridged-usdc-mint.compact with
// --feature-zkir-v3 (the secp256k1 surface lives in the compiler's zkir-v3
// library). It verifies ECDSA against supplied pubkeys — no recover-path
// primitives — so it compiles from source on rc.2.
export const BRIDGED_USDC_MINT_DIR = path.join(USDCX, 'managed', 'BridgedUsdcMint');

/** True once `yarn compile` has emitted the BridgedUsdcMint bindings. */
export function bridgedUsdcMintArtifactExists(): boolean {
  return artifactExists(BRIDGED_USDC_MINT_DIR);
}

/** Mutable ref the witness closures read from. Set immediately before each call. */
export interface AttestationRef {
  current: AssembledAttestation | null;
}

/** Build the seven witness closures for BridgedUsdcMint, reading from `ref`. */
export function buildUsdcxWitnesses(ref: AttestationRef): Witnesses {
  const getAttestation = (): AssembledAttestation => {
    if (!ref.current) {
      throw new Error(
        'attestation not set: assign attestationRef.current before submitting receiveAndMint',
      );
    }
    return ref.current;
  };

  // Each witness follows the generated `(context) => [privateState, value]`
  // signature; private state is threaded through unchanged.
  const w =
    <T>(get: (a: AssembledAttestation) => T) =>
    (ctx: { privateState: unknown }): [unknown, T] =>
      [ctx.privateState, get(getAttestation())];

  return {
    messageBytes: w((a) => a.messageBytes),
    attesterSig0: w((a) => sigRS(a.sig0)),
    attesterPubkey0: w((a) => pubkeyToPoint(a.pk0)),
    attesterSig1: w((a) => sigRS(a.sig1)),
    attesterPubkey1: w((a) => pubkeyToPoint(a.pk1)),
    mintAmount: w((a) => a.parsed.mintAmount),
    messageNonce: w((a) => a.parsed.messageNonce),
  };
}

/** Big-endian bytes → bigint. */
function beToBigInt(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
}

// `Secp256k1EcdsaSignature` witness type is `{ r: bigint, s: bigint }`.
function sigRS(s: RecoverableSignature): { r: bigint; s: bigint } {
  return { r: beToBigInt(s.r), s: beToBigInt(s.s) };
}

// `Secp256k1Point` witness type is `{ x: bigint, y: bigint, identity: boolean }`.
// `publicKey` is the 64-byte uncompressed key (no 0x04 prefix): 32-byte
// big-endian x then 32-byte big-endian y. An attester key is never infinity.
function pubkeyToPoint(publicKey: Uint8Array): { x: bigint; y: bigint; identity: boolean } {
  if (publicKey.length !== 64) {
    throw new Error(`expected 64-byte uncompressed pubkey, got ${publicKey.length}`);
  }
  return {
    x: beToBigInt(publicKey.subarray(0, 32)),
    y: beToBigInt(publicKey.subarray(32, 64)),
    identity: false,
  };
}
