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
  newAdminEncryptionKeys,
  newSecretKey,
  openBallot,
  proposalIdFromLabel,
  proposalLabel,
  sealBallot,
  voteInstance,
  keyFingerprint,
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

  it('gives admin keys a stable 16-hex-digit fingerprint', () => {
    const k = newAdminEncryptionKeys().publicKey;
    expect(keyFingerprint(k)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint(k)).toBe(keyFingerprint(k.slice()));
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

describe('proposal ids', () => {
  it('round-trips a label and rejects empty or over-long ones', () => {
    expect(proposalLabel(PID)).toBe('MIP-0018');
    expect(() => proposalIdFromLabel('')).toThrow();
    expect(() => proposalIdFromLabel('x'.repeat(33))).toThrow();
  });
});
