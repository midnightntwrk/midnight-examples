// This file is part of example-leaderboard.
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

/**
 * Utility functions for the leaderboard API.
 * @module
 */

const ADJECTIVES = [
  'Crimson', 'Shadow', 'Silver', 'Crystal', 'Golden', 'Ember', 'Frost', 'Storm',
  'Iron', 'Cobalt', 'Jade', 'Onyx', 'Scarlet', 'Azure', 'Violet', 'Neon',
  'Phantom', 'Rogue', 'Cosmic', 'Lunar', 'Solar', 'Arctic', 'Mystic', 'Nova',
  'Stealth', 'Prism', 'Cipher', 'Echo', 'Apex', 'Dusk', 'Blaze', 'Volt',
];
const NOUNS = [
  'Tiger', 'Phoenix', 'Wolf', 'Dragon', 'Falcon', 'Viper', 'Raven', 'Lynx',
  'Panther', 'Hawk', 'Cobra', 'Mantis', 'Shark', 'Eagle', 'Jaguar', 'Owl',
  'Fox', 'Bear', 'Crane', 'Orca', 'Sphinx', 'Hydra', 'Puma', 'Scorpion',
  'Raptor', 'Griffin', 'Coyote', 'Badger', 'Bison', 'Condor', 'Stag', 'Wasp',
];

/**
 * Decode a Bytes<32> field into a readable display name.
 *
 * Printable ASCII (custom/public mode) → displayed as-is.
 * Non-ASCII (anonymous mode) → deterministic generated name from bytes + entry ID.
 */
export const decodeDisplayName = (bytes: Uint8Array, entryId: number, score: number): string => {
  const decoded = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
  if (decoded.length > 0 && decoded.split('').every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127)) {
    return decoded;
  }
  const h = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
  const seed = (h ^ (entryId * 2654435761) ^ (score * 1597334677)) >>> 0;
  return `${ADJECTIVES[seed % ADJECTIVES.length]} ${NOUNS[(seed >>> 16) % NOUNS.length]}`;
};

/** Lower-case hex of a byte array. */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
