// This file is part of stagenet-q2 (adapted from example-usdcx).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Synthesises a Circle CCTP V2 burn attestation entirely off-chain using
// ephemeral test keypairs, so the dapp can exercise the on-Midnight
// verification logic without depending on a real Ethereum node or Circle's
// attestation API. The Compact contract is agnostic to which private keys
// signed — it checks `recoveredAddress ∈ registeredAttesters` and strict
// ascending order. Test-key inputs produce byte-for-byte identical witness
// shapes to a real Circle attestation.
//
// Message layout follows Circle's public CCTP V2 technical guide:
//   https://developers.circle.com/cctp/references/technical-guide#message-format
//
// V2 differs from V1 in three ways relevant to this fixture:
//   1. `nonce` is a 32-byte opaque identifier (V1 was 8-byte uint64).
//   2. Header carries two extra uint32 fields after `destinationCaller`:
//      `minFinalityThreshold` and `finalityThresholdExecuted`.
//   3. BurnMessage body adds `maxFee`, `feeExecuted`, `expirationBlock`,
//      and an (optionally empty) `hookData` tail.
//
// Total header = 148 bytes. Total fixed-body (with empty hookData) = 228
// bytes. Sum = 376, matching the contract's `Bytes<376>` witness.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// ============================================================================
// CCTP V2 layout constants (from Circle's technical guide)
// ============================================================================

/** Total message length the contract's `Bytes<376>` witness expects. */
export const CCTP_V2_MESSAGE_LEN = 376;

/** Fixed header length. */
export const CCTP_V2_HEADER_LEN = 148;

/** Minimum BurnMessage body length (i.e. with hookData empty). */
export const CCTP_V2_BURN_BODY_LEN = 228;

/** Outer envelope version. CCTP V1 = 0; CCTP V2 = 1. */
export const CCTP_V2_MESSAGE_VERSION = 1;

/** BurnMessage body version. CCTP V2 = 1. */
export const CCTP_V2_BURN_MESSAGE_VERSION = 1;

/** Ethereum source domain id per Circle CCTP V2 (mainnet). */
export const SOURCE_DOMAIN_ETHEREUM = 0;

/** "Standard" finality threshold (≈ block-finalised) per Circle's docs. */
export const FINALITY_THRESHOLD_STANDARD = 2000;

/** "Fast" finality threshold per Circle's docs. */
export const FINALITY_THRESHOLD_FAST = 1000;

// Header field offsets — Circle CCTP V2.
//
// Offset  Bytes    Field                       Type
// ------  -------  --------------------------  ------------------
//   0     4        version                     Uint<32>
//   4     4        sourceDomain                Uint<32>
//   8     4        destinationDomain           Uint<32>
//  12     32       nonce                       Bytes<32>
//  44     32       sender                      Bytes<32>
//  76     32       recipient                   Bytes<32>
// 108     32       destinationCaller           Bytes<32>
// 140     4        minFinalityThreshold        Uint<32>
// 144     4        finalityThresholdExecuted   Uint<32>
const OFF_VERSION = 0;
const OFF_SOURCE_DOMAIN = 4;
const OFF_DESTINATION_DOMAIN = 8;
const OFF_NONCE = 12;
const OFF_SENDER = 44;
const OFF_RECIPIENT = 76;
const OFF_DESTINATION_CALLER = 108;
const OFF_MIN_FINALITY_THRESHOLD = 140;
const OFF_FINALITY_THRESHOLD_EXECUTED = 144;

// BurnMessage body field offsets — relative to the start of the message
// (i.e. body offset 0 == message offset 148).
//
// Body offset  Bytes  Field             Type
// -----------  -----  ---------------   --------
//   0          4      version           Uint<32>
//   4          32     burnToken         Bytes<32>
//  36          32     mintRecipient     Bytes<32>
//  68          32     amount            Uint<256>
// 100          32     messageSender     Bytes<32>
// 132          32     maxFee            Uint<256>
// 164          32     feeExecuted       Uint<256>
// 196          32     expirationBlock   Uint<256>
// 228          dyn    hookData          Bytes<N>  (empty for our 376-byte total)
const OFF_BODY = CCTP_V2_HEADER_LEN; // 148
const OFF_BODY_VERSION = OFF_BODY + 0; // 148
const OFF_BODY_BURN_TOKEN = OFF_BODY + 4; // 152
const OFF_BODY_MINT_RECIPIENT = OFF_BODY + 4 + 32; // 184
const OFF_BODY_AMOUNT = OFF_BODY + 4 + 32 + 32; // 216
const OFF_BODY_MESSAGE_SENDER = OFF_BODY + 4 + 32 + 32 + 32; // 248
const OFF_BODY_MAX_FEE = OFF_BODY + 4 + 32 + 32 + 32 + 32; // 280
const OFF_BODY_FEE_EXECUTED = OFF_BODY + 4 + 32 * 5; // 312
const OFF_BODY_EXPIRATION_BLOCK = OFF_BODY + 4 + 32 * 6; // 344
// Body offset 228 (message offset 376) — hookData would start here. We allow
// none in this fixture so total stays at 376.

// ============================================================================
// Types
// ============================================================================

export interface AttesterKeypair {
  /** 32-byte secp256k1 private scalar. */
  readonly privateKey: Uint8Array;
  /** 64-byte uncompressed public key (no leading 0x04 prefix). */
  readonly publicKey: Uint8Array;
  /** 20-byte Ethereum address derived from `publicKey`. */
  readonly ethAddress: Uint8Array;
}

export interface RecoverableSignature {
  /** 32-byte big-endian r component. */
  readonly r: Uint8Array;
  /** 32-byte big-endian s component. */
  readonly s: Uint8Array;
  /** Recovery parity bit, {0, 1}. */
  readonly recovery: 0 | 1;
}

/**
 * Fields the caller may set on a fixture message. Any field left undefined is
 * written as zeros (which Circle's protocol treats as a valid "no value
 * supplied" sentinel for the optional fields). The contract does NOT enforce
 * any of these field values except via the digest, so placeholders are fine.
 */
export interface CctpV2BurnMessageFields {
  // ── Header ─────────────────────────────────────────────────────────────
  /** uint32. 0 = Ethereum mainnet per Circle. */
  readonly sourceDomain: number;
  /** uint32. Not enforced by this contract. */
  readonly destinationDomain: number;
  /** 32 bytes. CCTP V2 nonces are opaque bytes32 values. */
  readonly nonce: Uint8Array;
  /** 32 bytes. Source TokenMessenger; placeholder zeros work for the fixture. */
  readonly sender?: Uint8Array;
  /** 32 bytes. Destination handler (this contract); placeholder zeros work. */
  readonly recipient?: Uint8Array;
  /** 32 bytes. Zero = anyone may submit. Recommended for the fixture. */
  readonly destinationCaller?: Uint8Array;
  /** uint32. Standard = 2000, Fast = 1000. Default: standard. */
  readonly minFinalityThreshold?: number;
  /** uint32. Defaults to `minFinalityThreshold` (matches Circle's filled-in form). */
  readonly finalityThresholdExecuted?: number;

  // ── BurnMessage body ───────────────────────────────────────────────────
  /** 32 bytes. Source-chain USDC contract address (left-zero-padded). */
  readonly burnToken?: Uint8Array;
  /** 32 bytes. The 32-byte Midnight recipient identifier. */
  readonly mintRecipient: Uint8Array;
  /** uint256. The bridged amount. */
  readonly amount: bigint;
  /** 32 bytes. Original burner address (left-zero-padded). */
  readonly messageSender?: Uint8Array;
  /** uint256. Default 0. */
  readonly maxFee?: bigint;
  /** uint256. Default 0. */
  readonly feeExecuted?: bigint;
  /** uint256. Default 0. */
  readonly expirationBlock?: bigint;
}

export interface AssembledAttestation {
  /** The full 376-byte message — the contract recomputes keccak256 over this. */
  readonly messageBytes: Uint8Array;
  /** keccak256(messageBytes); equals the in-circuit `digest`. */
  readonly digest: Uint8Array;
  /** Signature produced by the attester registered in slot 0. */
  readonly sig0: RecoverableSignature;
  /** Signature produced by the attester registered in slot 1. */
  readonly sig1: RecoverableSignature;
  /** 64-byte uncompressed public key (no 0x04 prefix) of the slot-0 attester. */
  readonly pk0: Uint8Array;
  /** 64-byte uncompressed public key (no 0x04 prefix) of the slot-1 attester. */
  readonly pk1: Uint8Array;
  /** Parsed-out fields the contract takes as witnesses. */
  readonly parsed: {
    readonly sourceDomain: Uint8Array; // 4 bytes BE
    readonly messageNonce: Uint8Array; // 32 bytes (V2 nonce is bytes32)
    readonly mintAmount: bigint; // uint128 max — contract truncates
    readonly mintRecipient: Uint8Array; // 32 bytes
  };
  /** keccak256(sourceDomain || nonce); equals the in-circuit `nonceKey`. */
  readonly nonceKey: Uint8Array;
}

export interface BuildAttestationOptions {
  readonly fields: CctpV2BurnMessageFields;
  readonly attesterA: AttesterKeypair;
  readonly attesterB: AttesterKeypair;
}

// ============================================================================
// Keypair generation
// ============================================================================

/**
 * Generates an ephemeral secp256k1 keypair and derives its Ethereum address.
 * Ethereum addr = last 20 bytes of keccak256(uncompressed_pubkey[1:])
 * (i.e. keccak256 over the 64-byte uncompressed key without its 0x04 prefix).
 */
export function generateAttesterKeypair(): AttesterKeypair {
  const privateKey = secp256k1.utils.randomSecretKey();
  const uncompressed = secp256k1.getPublicKey(privateKey, false); // 65 bytes, 0x04-prefixed
  const publicKey = uncompressed.slice(1); // 64 bytes, no prefix
  const ethAddress = keccak_256(publicKey).slice(12); // last 20 of 32
  return { privateKey, publicKey, ethAddress };
}

// ============================================================================
// Nonce helpers — V2 nonces are 32 bytes; sometimes convenient to derive from
// a counter or a hash for fixture reproducibility.
// ============================================================================

/** Builds a 32-byte nonce as the big-endian encoding of a counter (left-zero-padded). */
export function nonceFromCounter(counter: bigint): Uint8Array {
  if (counter < 0n) throw new RangeError("counter must be non-negative");
  const buf = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(counter & 0xffn);
    counter >>= 8n;
  }
  if (counter !== 0n) throw new RangeError("counter exceeds 32 bytes");
  return buf;
}

// ============================================================================
// Byte helpers — write into the message via a single DataView.
//
// DataView defaults to big-endian (when the `littleEndian` flag is omitted or
// false), which matches Ethereum / CCTP byte order. For widths larger than
// 64 bits (uint256), we compose 4 × setBigUint64 to span the full 32 bytes.
// ============================================================================

const MASK_64 = (1n << 64n) - 1n;

function writeUint32BE(view: DataView, offset: number, value: number): void {
  if (value < 0 || value > 0xffffffff || !Number.isInteger(value)) {
    throw new RangeError(`uint32 out of range: ${value}`);
  }
  view.setUint32(offset, value);
}

function writeUint256BE(view: DataView, offset: number, value: bigint): void {
  if (value < 0n) throw new RangeError("uint256: negative");
  if (value >> 256n !== 0n) throw new RangeError("uint256: overflow");
  // High bytes first (big-endian): 4 × 64 bits = 256 bits.
  view.setBigUint64(offset, (value >> 192n) & MASK_64); // bits 255..192
  view.setBigUint64(offset + 8, (value >> 128n) & MASK_64); // bits 191..128
  view.setBigUint64(offset + 16, (value >> 64n) & MASK_64); // bits 127..64
  view.setBigUint64(offset + 24, value & MASK_64); // bits  63..0
}

function writeBytes(
  view: DataView,
  offset: number,
  src: Uint8Array | undefined,
  expectedLen: number,
): void {
  if (!src) return; // implicit zeros
  if (src.length !== expectedLen) {
    throw new RangeError(`expected ${expectedLen} bytes, got ${src.length}`);
  }
  // DataView has no bulk-copy primitive; wrap the same buffer region with a
  // Uint8Array view and use its `set`. The wrapper is a thin alias, not a copy.
  new Uint8Array(view.buffer, view.byteOffset + offset, expectedLen).set(src);
}

// ============================================================================
// CCTP V2 message assembly
// ============================================================================

/**
 * Assembles a 376-byte CCTP V2 burn message blob per Circle's technical guide.
 *
 * Header (148 bytes) → BurnMessage body (228 bytes, with empty hookData).
 * Optional caller fields default to zero; the Compact contract treats every
 * byte beyond what it hashes for the digest as opaque, so placeholders are
 * sufficient for verification.
 */
export function assembleCctpV2BurnMessage(fields: CctpV2BurnMessageFields): Uint8Array {
  if (fields.nonce.length !== 32) {
    throw new RangeError(`nonce must be 32 bytes (V2), got ${fields.nonce.length}`);
  }
  if (fields.mintRecipient.length !== 32) {
    throw new RangeError(`mintRecipient must be 32 bytes, got ${fields.mintRecipient.length}`);
  }

  const msg = new Uint8Array(CCTP_V2_MESSAGE_LEN);
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);

  // ---- Header (offsets 0..147) --------------------------------------------
  writeUint32BE(view, OFF_VERSION, CCTP_V2_MESSAGE_VERSION);
  writeUint32BE(view, OFF_SOURCE_DOMAIN, fields.sourceDomain);
  writeUint32BE(view, OFF_DESTINATION_DOMAIN, fields.destinationDomain);
  writeBytes(view, OFF_NONCE, fields.nonce, 32);
  writeBytes(view, OFF_SENDER, fields.sender, 32);
  writeBytes(view, OFF_RECIPIENT, fields.recipient, 32);
  writeBytes(view, OFF_DESTINATION_CALLER, fields.destinationCaller, 32);

  const minFt = fields.minFinalityThreshold ?? FINALITY_THRESHOLD_STANDARD;
  const exeFt = fields.finalityThresholdExecuted ?? minFt;
  writeUint32BE(view, OFF_MIN_FINALITY_THRESHOLD, minFt);
  writeUint32BE(view, OFF_FINALITY_THRESHOLD_EXECUTED, exeFt);

  // ---- BurnMessage body (offsets 148..375; hookData empty) ----------------
  writeUint32BE(view, OFF_BODY_VERSION, CCTP_V2_BURN_MESSAGE_VERSION);
  writeBytes(view, OFF_BODY_BURN_TOKEN, fields.burnToken, 32);
  writeBytes(view, OFF_BODY_MINT_RECIPIENT, fields.mintRecipient, 32);
  writeUint256BE(view, OFF_BODY_AMOUNT, fields.amount);
  writeBytes(view, OFF_BODY_MESSAGE_SENDER, fields.messageSender, 32);
  writeUint256BE(view, OFF_BODY_MAX_FEE, fields.maxFee ?? 0n);
  writeUint256BE(view, OFF_BODY_FEE_EXECUTED, fields.feeExecuted ?? 0n);
  writeUint256BE(view, OFF_BODY_EXPIRATION_BLOCK, fields.expirationBlock ?? 0n);
  // hookData: empty, so message ends exactly at offset 376.

  return msg;
}

// ============================================================================
// Signing + sorting
// ============================================================================

function signRecoverable(messageHash: Uint8Array, privateKey: Uint8Array): RecoverableSignature {
  const sig = secp256k1.sign(messageHash, privateKey, {
    prehash: false,
    format: "recovered",
  });
  // @noble/curves v2 lays out the recovered signature as [recovery, r, s]
  // (recovery byte FIRST), not r || s || recovery.
  return {
    r: sig.slice(1, 33),
    s: sig.slice(33, 65),
    recovery: sig[0] as 0 | 1,
  };
}

function compareEthAddresses(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== 20 || b.length !== 20) throw new Error("expected 20-byte addresses");
  for (let i = 0; i < 20; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

/**
 * Signs `digest` with both keypairs and assigns them positionally: `attesterA`
 * → slot 0, `attesterB` → slot 1. The contract binds each supplied pubkey to a
 * registered attester by x-coordinate (`pk0.x == attester0X`, `pk1.x ==
 * attester1X`), so the slot assignment here must match the deploy-time
 * registration order — it does NOT depend on recovered-address ordering.
 * Distinctness is still guarded: two attesters with the same address are
 * rejected (their x-coords could not be registered to distinct slots).
 */
export function signAndSort(
  digest: Uint8Array,
  attesterA: AttesterKeypair,
  attesterB: AttesterKeypair,
): {
  sig0: RecoverableSignature;
  sig1: RecoverableSignature;
  pk0: Uint8Array;
  pk1: Uint8Array;
} {
  if (compareEthAddresses(attesterA.ethAddress, attesterB.ethAddress) === 0) {
    throw new Error(
      'attester addresses are equal — refusing to produce a "same attester twice" attestation',
    );
  }
  return {
    sig0: signRecoverable(digest, attesterA.privateKey),
    sig1: signRecoverable(digest, attesterB.privateKey),
    pk0: attesterA.publicKey,
    pk1: attesterB.publicKey,
  };
}

// ============================================================================
// End-to-end attestation assembly
// ============================================================================

/**
 * Builds a complete attestation bundle ready to be passed as witnesses to the
 * `receiveAndMint` circuit. Includes the recomputed digest and nonceKey so the
 * driver can assert against indexer state with the same keys the contract
 * would have written.
 *
 * `nonceKey` is the raw 32-byte CCTP nonce, matching the contract's
 * `nonceKey = disclose(messageNonce())`.
 */
export function buildAttestation(opts: BuildAttestationOptions): AssembledAttestation {
  const messageBytes = assembleCctpV2BurnMessage(opts.fields);
  const digest = keccak_256(messageBytes);
  const { sig0, sig1, pk0, pk1 } = signAndSort(digest, opts.attesterA, opts.attesterB);

  const sourceDomain = new Uint8Array(4);
  writeUint32BE(new DataView(sourceDomain.buffer), 0, opts.fields.sourceDomain);
  const messageNonce = opts.fields.nonce.slice(); // copy — 32 bytes

  // nonceKey is the raw CCTP nonce: the contract keys replay protection on
  // `messageNonce()` directly (`nonceKey = disclose(nonce)`).
  const nonceKey = messageNonce.slice();

  return {
    messageBytes,
    digest,
    sig0,
    sig1,
    pk0,
    pk1,
    parsed: {
      sourceDomain,
      messageNonce,
      mintAmount: opts.fields.amount,
      mintRecipient: opts.fields.mintRecipient,
    },
    nonceKey,
  };
}

// ============================================================================
// Hex helper (local; the project's utils/hex.ts is for the on-Midnight side)
// ============================================================================

export function toHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
