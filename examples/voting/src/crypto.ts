// This file is part of example-voting.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Off-chain cryptography for the voting example.
//
// Keys and ids: a voter's (or the admin's) whole identity is one 32-byte
// secret. The voter key, ballot nullifier and ballot salt are computed by the
// contract's own pure circuits, so this file can't drift from the circuit.
//
// Ballot sealing: `cast` stores a hiding commitment to (vote, salt) and, next
// to it, the same opening encrypted to every admin's X25519 key, so any admin
// can decrypt and `count` it. The scheme is a multi-recipient sealed box:
//
//   header      = 0x01 ‖ ephPub ‖ n
//   context     = proposalId ‖ contract address (the vote this blob belongs to)
//   contentKey  = 32 random bytes
//   body        = XChaCha20-Poly1305(contentKey, nonce, aad = header ‖ context)(vote ‖ salt)
//   per admin i:
//     kek_i     = HKDF-SHA256(X25519(eph, adminKey_i), salt = ephPub ‖ adminKey_i,
//                             info = "mip-vote:ballot:v1", 32)
//     wrap_i    = XChaCha20-Poly1305(kek_i, nonce_i, aad = header ‖ context)(contentKey)
//
// Wire format (version 1):
//   0x01 ‖ ephPub(32) ‖ n(1) ‖ n × [nonce_i(24) ‖ wrap_i(48)] ‖ nonce(24) ‖ body(33 + 16)
//
// The circuit can't check this blob against the commitment. A voter's client
// can write one that is unreadable, or that decrypts to an opening that doesn't
// match the commitment. The admin checks every opening with `ballotCommit`
// before submitting it (`checkOpening`), skips the ones that fail, and the
// voter can still count their own ballot. A bad blob only hurts its voter.

import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { pureCircuits, Vote } from '../contract/managed/voting/contract/index.js';

export { Vote };

const VERSION = 1;
const INFO = new TextEncoder().encode('mip-vote:ballot:v1');
const NONCE = 24;
const WRAP = 32 + 16;
const PLAIN = 1 + 32;

/** A fresh 32-byte secret for a voter or the admin. Back it up: it can't be recovered. */
export const newSecretKey = (): Uint8Array => randomBytes(32);

/** The admin's on-chain key hash (`adminPk`). */
export const adminKey = (sk: Uint8Array): Uint8Array => pureCircuits.adminKey(sk);

/** The voter key the admin enrols. Safe to share: it is a hash of the secret. */
export const voterKey = (sk: Uint8Array): Uint8Array => pureCircuits.voterKey(sk);

/** A deployed vote: its proposal id and its contract address (`kernel.self()`, 32 bytes). */
export type VoteInstance = { proposalId: Uint8Array; address: Uint8Array };

/** The instance from a ledger's proposalId and a hex contract address. */
export const voteInstance = (proposalId: Uint8Array, address: string): VoteInstance => {
  const bytes = fromHex(address);
  if (bytes.length !== 32) throw new Error('Contract address must be 32 bytes of hex');
  return { proposalId, address: bytes };
};

/** The nullifier `cast` publishes for this voter in this vote. */
export const ballotNullifier = (sk: Uint8Array, v: VoteInstance): Uint8Array =>
  pureCircuits.ballotNullifier(sk, v.proposalId, v.address);

/** The commitment salt for this voter in this vote. Never published. */
export const ballotSalt = (sk: Uint8Array, v: VoteInstance): Uint8Array =>
  pureCircuits.ballotSalt(sk, v.proposalId, v.address);

/** The commitment `cast` stores for an opening. */
export const ballotCommit = (vote: Vote, salt: Uint8Array): Uint8Array => pureCircuits.ballotCommit(vote, salt);

/** A short fingerprint of an admin encryption key, to confirm out of band before casting. */
export const keyFingerprint = (key: Uint8Array): string => toHex(sha256(key)).slice(0, 16);

/**
 * The on-chain proposal id: the UTF-8 label (for example "MIP-0018"),
 * zero-padded to 32 bytes. Labels longer than 32 bytes are rejected.
 */
export const proposalIdFromLabel = (label: string): Uint8Array => {
  const bytes = new TextEncoder().encode(label);
  if (bytes.length === 0 || bytes.length > 32) throw new Error('Proposal label must be 1 to 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
};

/** The label back from a proposal id (trailing zero bytes dropped). */
export const proposalLabel = (proposalId: Uint8Array): string => {
  let end = proposalId.length;
  while (end > 0 && proposalId[end - 1] === 0) end--;
  return new TextDecoder().decode(proposalId.subarray(0, end));
};

/** An admin's X25519 key pair for decrypting ballots. */
export type AdminEncryptionKeys = { secretKey: Uint8Array; publicKey: Uint8Array };

export const newAdminEncryptionKeys = (): AdminEncryptionKeys => {
  const { secretKey, publicKey } = x25519.keygen();
  return { secretKey, publicKey };
};

export const adminEncryptionPublicKey = (secretKey: Uint8Array): Uint8Array => x25519.getPublicKey(secretKey);

/**
 * Whether a ballot can be encrypted to this X25519 key. A low-order key (all
 * zeros, u = 1, …) gives an all-zero shared secret for every scalar, so noble
 * refuses it and nobody could decrypt with it anyway. One probe is enough.
 */
export const isUsableAdminKey = (key: Uint8Array): boolean => {
  if (key.length !== 32) return false;
  try {
    x25519.getSharedSecret(x25519.utils.randomSecretKey(), key);
    return true;
  } catch {
    return false;
  }
};

/** Splits published admin keys into the ones a ballot can be encrypted to and the rest. */
export const usableAdminKeys = (keys: readonly Uint8Array[]): { usable: Uint8Array[]; unusable: Uint8Array[] } => {
  const usable: Uint8Array[] = [];
  const unusable: Uint8Array[] = [];
  for (const k of keys) (isUsableAdminKey(k) ? usable : unusable).push(k);
  return { usable, unusable };
};

/** A ballot opening: what `count` takes besides the nullifier. */
export type BallotOpening = { vote: Vote; salt: Uint8Array };

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const kek = (shared: Uint8Array, ephPub: Uint8Array, recipient: Uint8Array): Uint8Array =>
  hkdf(sha256, shared, concat(ephPub, recipient), INFO, 32);

const context = (header: Uint8Array, v: VoteInstance) => concat(header, v.proposalId, v.address);

const isVote = (v: number): v is Vote => v === Vote.YES || v === Vote.NO || v === Vote.ABSTAIN;

/**
 * Encrypts a ballot opening to every admin key. The header and the vote
 * (proposal id and contract address) are bound in as associated data, so a
 * blob copied into another vote won't decrypt. Unusable keys (see
 * `isUsableAdminKey`) are left out, so one bad published key can't block a cast.
 */
export const sealBallot = (opening: BallotOpening, published: readonly Uint8Array[], v: VoteInstance): Uint8Array => {
  const adminKeys = usableAdminKeys(published).usable;
  if (adminKeys.length === 0) throw new Error('No usable admin keys to encrypt the ballot to');
  if (adminKeys.length > 255) throw new Error('Need 1 to 255 admin keys');
  if (opening.salt.length !== 32) throw new Error('salt must be 32 bytes');
  const contentKey = randomBytes(32);
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const aad = context(concat(Uint8Array.of(VERSION), ephPub, Uint8Array.of(adminKeys.length)), v);
  const wraps = adminKeys.map((recipient) => {
    const nonce = randomBytes(NONCE);
    const key = kek(x25519.getSharedSecret(eph, recipient), ephPub, recipient);
    return concat(nonce, xchacha20poly1305(key, nonce, aad).encrypt(contentKey));
  });
  const nonce = randomBytes(NONCE);
  const body = xchacha20poly1305(contentKey, nonce, aad).encrypt(
    concat(Uint8Array.of(opening.vote), opening.salt),
  );
  return concat(Uint8Array.of(VERSION), ephPub, Uint8Array.of(adminKeys.length), ...wraps, nonce, body);
};

/**
 * Decrypts a ballot with one admin's X25519 secret. Returns undefined if the
 * blob is malformed or wasn't encrypted to this key: the admin skips it, and
 * its voter can count it themselves.
 */
export const openBallot = (
  blob: Uint8Array,
  adminSecretKey: Uint8Array,
  v: VoteInstance,
): BallotOpening | undefined => {
  const header = 1 + 32 + 1;
  if (blob.length < header || blob[0] !== VERSION) return undefined;
  const ephPub = blob.subarray(1, 33);
  const n = blob[33];
  const bodyStart = header + n * (NONCE + WRAP);
  if (blob.length !== bodyStart + NONCE + PLAIN + 16) return undefined;
  const me = x25519.getPublicKey(adminSecretKey);
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(adminSecretKey, ephPub);
  } catch {
    return undefined;
  }
  const key = kek(shared, ephPub, me);
  const aad = context(blob.subarray(0, header), v);
  for (let i = 0; i < n; i++) {
    const at = header + i * (NONCE + WRAP);
    let contentKey: Uint8Array;
    try {
      contentKey = xchacha20poly1305(key, blob.subarray(at, at + NONCE), aad).decrypt(
        blob.subarray(at + NONCE, at + NONCE + WRAP),
      );
    } catch {
      continue;
    }
    try {
      const plain = xchacha20poly1305(contentKey, blob.subarray(bodyStart, bodyStart + NONCE), aad).decrypt(
        blob.subarray(bodyStart + NONCE),
      );
      if (!isVote(plain[0])) return undefined;
      return { vote: plain[0], salt: plain.slice(1) };
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/** Whether an opening matches the commitment stored for its ballot, so `count` will accept it. */
export const checkOpening = (opening: BallotOpening, commitment: Uint8Array): boolean =>
  toHex(ballotCommit(opening.vote, opening.salt)) === toHex(commitment);

/** The opening a voter can rebuild from their secret alone (the self-count fallback). */
export const ownOpening = (sk: Uint8Array, v: VoteInstance, vote: Vote): BallotOpening => ({
  vote,
  salt: ballotSalt(sk, v),
});

/** The result rule: a proposal passes iff yes > no among counted ballots (a tie fails). */
export const passes = (tally: { yes: bigint; no: bigint }): boolean => tally.yes > tally.no;
