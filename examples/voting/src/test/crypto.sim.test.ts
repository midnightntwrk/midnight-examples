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

// In-memory tests for the ballot sealing in src/crypto.ts (no contract calls).

import { describe, expect, it } from 'vitest';
import {
  Vote,
  isUsableAdminKey,
  newAdminEncryptionKeys,
  newSecretKey,
  openBallot,
  proposalIdFromLabel,
  proposalLabel,
  sealBallot,
  voteInstance,
  keyFingerprint,
  usableAdminKeys,
  adminKeySetFingerprint,
  ballotRecipients,
  MAX_ADMIN_KEYS,
} from '../crypto.js';

const PID = proposalIdFromLabel('MIP-0018');
const V = voteInstance(PID, 'ab'.repeat(32));
const opening = { vote: Vote.ABSTAIN, salt: newSecretKey() };

describe('ballot sealing', () => {
  it('round-trips for every recipient', () => {
    const admins = [newAdminEncryptionKeys(), newAdminEncryptionKeys(), newAdminEncryptionKeys()];
    const blob = sealBallot(opening, admins.map((a) => a.publicKey), V);
    for (const a of admins) expect(openBallot(blob, a.secretKey, V)).toEqual(opening);
  });

  it('is randomised: the same opening never gives the same blob', () => {
    const a = newAdminEncryptionKeys();
    expect(sealBallot(opening, [a.publicKey], V)).not.toEqual(sealBallot(opening, [a.publicKey], V));
  });

  it('does not open with a key it was not sealed to', () => {
    const blob = sealBallot(opening, [newAdminEncryptionKeys().publicKey], V);
    expect(openBallot(blob, newAdminEncryptionKeys().secretKey, V)).toBeUndefined();
  });

  it('does not open under another proposal id or another contract', () => {
    const a = newAdminEncryptionKeys();
    const blob = sealBallot(opening, [a.publicKey], V);
    expect(openBallot(blob, a.secretKey, voteInstance(proposalIdFromLabel('MIP-0019'), 'ab'.repeat(32)))).toBeUndefined();
    expect(openBallot(blob, a.secretKey, voteInstance(PID, 'cd'.repeat(32)))).toBeUndefined();
  });

  it('gives admin keys a stable 32-hex-digit fingerprint', () => {
    const k = newAdminEncryptionKeys().publicKey;
    expect(keyFingerprint(k)).toMatch(/^[0-9a-f]{32}$/);
    expect(keyFingerprint(k)).toBe(keyFingerprint(k.slice()));
  });

  it('fingerprints an admin key set in any order, and changes when a key is added or swapped', () => {
    const [a, b, c] = [0, 1, 2].map(() => newAdminEncryptionKeys().publicKey);
    const fp = adminKeySetFingerprint([a, b]);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(adminKeySetFingerprint([b, a])).toBe(fp);
    expect(adminKeySetFingerprint([a, b, c])).not.toBe(fp);
    expect(adminKeySetFingerprint([a, c])).not.toBe(fp);
    expect(adminKeySetFingerprint([a])).not.toBe(fp);
  });

  it('pads ballot recipients with zeros to MAX_ADMIN_KEYS, keys first', () => {
    const k = newAdminEncryptionKeys().publicKey;
    const r = ballotRecipients([k]);
    expect(r).toHaveLength(MAX_ADMIN_KEYS);
    expect(r[0]).toEqual(k);
    expect(r.slice(1).every((x) => x.length === 32 && x.every((b) => b === 0))).toBe(true);
    expect(() => ballotRecipients([])).toThrow('admin keys');
    expect(() => ballotRecipients(Array.from({ length: MAX_ADMIN_KEYS + 1 }, () => k))).toThrow('admin keys');
  });

  it('rejects any tampered byte, a truncated blob and an unknown version', () => {
    const a = newAdminEncryptionKeys();
    const blob = sealBallot(opening, [a.publicKey], V);
    for (const i of [0, 1, 33, 40, blob.length - 20, blob.length - 1]) {
      const bad = blob.slice();
      bad[i] ^= 1;
      expect(openBallot(bad, a.secretKey, V)).toBeUndefined();
    }
    expect(openBallot(blob.subarray(0, blob.length - 1), a.secretKey, V)).toBeUndefined();
    expect(openBallot(new Uint8Array(0), a.secretKey, V)).toBeUndefined();
  });

  it('needs at least one admin key and a 32-byte salt', () => {
    expect(() => sealBallot(opening, [], V)).toThrow('admin keys');
    expect(() => sealBallot({ vote: Vote.YES, salt: new Uint8Array(8) }, [newAdminEncryptionKeys().publicKey], V)).toThrow(
      'salt',
    );
  });
});

// Low-order X25519 points: every scalar gives an all-zero shared secret.
const ZERO_KEY = new Uint8Array(32);
const ONE_KEY = Uint8Array.from([1, ...new Array<number>(31).fill(0)]);

describe('unusable admin keys', () => {
  it('rejects low-order and wrong-length keys and accepts a real one', () => {
    expect(isUsableAdminKey(ZERO_KEY)).toBe(false);
    expect(isUsableAdminKey(ONE_KEY)).toBe(false);
    expect(isUsableAdminKey(new Uint8Array(31))).toBe(false);
    expect(isUsableAdminKey(newAdminEncryptionKeys().publicKey)).toBe(true);
  });

  it('splits a published key set into usable and unusable keys', () => {
    const good = newAdminEncryptionKeys().publicKey;
    expect(usableAdminKeys([ZERO_KEY, good, ONE_KEY])).toEqual({ usable: [good], unusable: [ZERO_KEY, ONE_KEY] });
  });

  it('seals to the usable keys when a low-order key is published, in either position', () => {
    const a = newAdminEncryptionKeys();
    for (const keys of [[ZERO_KEY, a.publicKey], [a.publicKey, ZERO_KEY], [ONE_KEY, a.publicKey, ZERO_KEY]]) {
      const blob = sealBallot(opening, keys, V);
      expect(blob[33]).toBe(1);
      expect(openBallot(blob, a.secretKey, V)).toEqual(opening);
    }
  });

  it('refuses to seal when no published key is usable', () => {
    expect(() => sealBallot(opening, [ZERO_KEY, ONE_KEY], V)).toThrow('No usable admin keys');
  });
});

describe('proposal ids', () => {
  it('round-trips a label and rejects empty or over-long ones', () => {
    expect(proposalLabel(PID)).toBe('MIP-0018');
    expect(() => proposalIdFromLabel('')).toThrow();
    expect(() => proposalIdFromLabel('x'.repeat(33))).toThrow();
  });
});
