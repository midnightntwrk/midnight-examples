// Off-circuit encodings for the stdlib signature types, following the vendor
// QA drivers (compact-end-2-end@672bc50, regression/qa/src/cases/stdlib/crypto):
//
//   Curve25519Point          { x, y }   affine, decompressed from the 32-byte
//                                       RFC 8032 encoding. No identity flag:
//                                       the Edwards identity is (0, 1).
//   Ed25519Signature         { r, s }   r = decompressed R (sig bytes 0..31),
//                                       s = sig bytes 32..63 read LITTLE-endian.
//   Secp256r1Point           { x, y, identity }
//   Secp256r1EcdsaSignature  { r, s }   plain integers (big-endian on the wire).
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';

export type Curve25519Point = { x: bigint; y: bigint };
export type Ed25519Signature = { r: Curve25519Point; s: bigint };
export type Secp256r1Point = { x: bigint; y: bigint; identity: boolean };
export type Secp256r1EcdsaSignature = { r: bigint; s: bigint };

export const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export function edPoint(compressed: Uint8Array): Curve25519Point {
  const { x, y } = ed25519.Point.fromBytes(compressed).toAffine();
  return { x, y };
}

const leBigint = (b: Uint8Array): bigint => b.reduceRight((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
const beBigint = (b: Uint8Array): bigint => b.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);

export function edSignature(sig: Uint8Array): Ed25519Signature {
  return { r: edPoint(sig.subarray(0, 32)), s: leBigint(sig.subarray(32, 64)) };
}

/** From a SEC1 public key (compressed or uncompressed). */
export function p256Point(sec1: Uint8Array): Secp256r1Point {
  const { x, y } = p256.Point.fromBytes(sec1).toAffine();
  return { x, y, identity: false };
}

/** From a 64-byte compact (r || s) signature. */
export function p256Signature(compact: Uint8Array): Secp256r1EcdsaSignature {
  return { r: beBigint(compact.subarray(0, 32)), s: beBigint(compact.subarray(32, 64)) };
}

/** The P-256 group order. */
export const P256_N = p256.Point.CURVE().n;

/** Splits s into the two 128-bit limbs verify_low_s takes. */
export const limbs = (s: bigint): [bigint, bigint] => [s >> 128n, s & ((1n << 128n) - 1n)];

export const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
