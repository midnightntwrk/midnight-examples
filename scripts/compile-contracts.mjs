#!/usr/bin/env node
// This file is part of mn-examples.
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

// Compiles every contract of one example. An example's `compile` and
// `compile:fast` scripts run this from its own directory:
//
//   yarn compile        → node ../../scripts/compile-contracts.mjs
//   yarn compile:fast   → node ../../scripts/compile-contracts.mjs --skip-zk
//
// Each contract/<c>.compact compiles to contract/managed/<c>, one after the
// other, stopping at the first failure. Modules and files another contract
// imports or includes are skipped (contractSources in lib/contract-info.mjs).
// So a second contract (a test-only token beside the main one) needs no
// package.json edit: add contract/<token>.compact, compile, and
// `yarn new:example <name> --derive` wires it into contract/index.ts and the
// devnet test.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { contractSources } from './lib/contract-info.mjs';
import { fail } from './lib/template.mjs';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--skip-zk');
if (unknown.length) fail(`unknown argument(s): ${unknown.join(' ')}. Usage: compile-contracts.mjs [--skip-zk]`);
const skipZk = args.includes('--skip-zk');

const EXAMPLE_DIR = process.cwd();
if (!fs.existsSync(path.join(EXAMPLE_DIR, 'contract'))) {
  fail('run this from an example directory (one with contract/), via `yarn compile` or `yarn compile:fast`.');
}
const contracts = contractSources(EXAMPLE_DIR);
if (contracts.length === 0) fail('no contract/*.compact to compile.');

for (const { name } of contracts) {
  const cmd = ['compile', ...(skipZk ? ['--skip-zk'] : []), `contract/${name}.compact`, `contract/managed/${name}`];
  console.log(`• compact ${cmd.join(' ')}`);
  const r = spawnSync('compact', cmd, { cwd: EXAMPLE_DIR, stdio: 'inherit' });
  if (r.error) fail(`could not run compact: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
