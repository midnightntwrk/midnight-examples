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

// `mnkit add contract <name>`: another contract next to the project's own.
// compile and derive find contracts by scanning contract/ (contractSources),
// so this only writes the stub; `npm run compile` then `mnkit derive` wire it
// into contract/index.ts and the devnet test. derive can't wire a secondary
// contract that has witnesses (witnesses.ts belongs to the primary): it says
// so, and that one is wired by hand.

import fs from 'node:fs';
import path from 'node:path';
import { NAME_RE, fail } from '../lib/template.mjs';
import { PKG_ROOT } from '../lib/toolchain.mjs';

/** The contract stub init writes: its pragma is the pinned language version. */
const STUB = path.join(PKG_ROOT, 'templates', 'example', 'contract', '__name__.compact');

/** Writes contract/<name>.compact in project `dir` (primary contract `project`); returns its path. */
export function addContract(dir, name, { project }) {
  if (!name) fail('mnkit add contract needs a name: mnkit add contract my-token');
  if (!NAME_RE.test(name)) {
    fail(`invalid contract name '${name}'. Use kebab-case: lowercase letters/digits, hyphen-separated (e.g. my-token).`);
  }
  const contractDir = path.join(dir, 'contract');
  if (!fs.existsSync(contractDir)) fail('run this from a project directory (one with a contract/ directory).');
  if (name === project) fail(`'${name}' is the project's own contract (contract/${name}.compact).`);
  const file = path.join(contractDir, `${name}.compact`);
  if (fs.existsSync(file)) fail(`contract/${name}.compact already exists.`);
  fs.writeFileSync(file, fs.readFileSync(STUB, 'utf8'));
  return file;
}

export function printAddContractNextSteps(name) {
  console.log(`✔ Created contract/${name}.compact`);
  console.log('\nNext:');
  console.log(`  1. Write the contract in contract/${name}.compact`);
  console.log('  2. npm run compile:fast && npx mnkit derive   # wires it into contract/index.ts and the devnet test');
  console.log('  A contract with witnesses is not wired automatically: derive lists it, and you wire it by hand.');
}
