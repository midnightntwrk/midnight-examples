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

// The key files the CLI (scripts/cli.ts) and the deploy (contract/deploy-args.ts)
// read. They hold secrets: they're written with mode 0600 under
// examples/voting/.voting/ (gitignored), or VOTING_KEYS_DIR to keep several
// identities on one machine for a dry run.
//
//   admin.json  { secretKey, encSecretKey, encPublicKey }  the admin's contract
//               secret (adminPk = its hash) and X25519 ballot-decryption key pair
//   voter.json  { secretKey }  one voter's secret; voterKey(secretKey) is what
//               the admin enrols. The same file works for every vote.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHex, fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { newAdminEncryptionKeys, newSecretKey } from './crypto.js';

export const keysDir = (): string =>
  process.env['VOTING_KEYS_DIR'] ?? fileURLToPath(new URL('../.voting/', import.meta.url));

export type AdminKeys = { secretKey: Uint8Array; encSecretKey: Uint8Array; encPublicKey: Uint8Array };
export type VoterKeys = { secretKey: Uint8Array };

const file = (name: string) => path.join(keysDir(), name);

function writeSecret(name: string, value: Record<string, Uint8Array>, overwrite: boolean): string {
  const f = file(name);
  if (fs.existsSync(f) && !overwrite) throw new Error(`${f} already exists; pass --force to replace it (the old key is lost)`);
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const json = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toHex(v)]));
  fs.writeFileSync(f, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
  return f;
}

function readSecret(name: string, hint: string): Record<string, Uint8Array> {
  const f = file(name);
  if (!fs.existsSync(f)) throw new Error(`No ${f}. Run \`npm run vote -- ${hint}\` first.`);
  const json = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, string>;
  return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, fromHex(v)]));
}

export function createAdminKeys(overwrite = false): { keys: AdminKeys; file: string } {
  const enc = newAdminEncryptionKeys();
  const keys = { secretKey: newSecretKey(), encSecretKey: enc.secretKey, encPublicKey: enc.publicKey };
  return { keys, file: writeSecret('admin.json', keys, overwrite) };
}

export const readAdminKeys = (): AdminKeys => readSecret('admin.json', 'admin keygen') as AdminKeys;

export function createVoterKeys(overwrite = false): { keys: VoterKeys; file: string } {
  const keys = { secretKey: newSecretKey() };
  return { keys, file: writeSecret('voter.json', keys, overwrite) };
}

export const readVoterKeys = (): VoterKeys => readSecret('voter.json', 'voter keygen') as VoterKeys;
