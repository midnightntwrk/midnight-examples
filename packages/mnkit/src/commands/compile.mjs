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

// `mnkit compile [--skip-zk]`: compiles every contract of the project in
// `dir`. Each contract/<c>.compact compiles to contract/managed/<c>, one after
// the other, stopping at the first failure. Modules and files another
// contract imports or includes are skipped (contractSources in
// lib/contract-info.mjs). So a second contract (a test-only token beside the
// main one) needs no package.json edit: add contract/<token>.compact, compile,
// and derive wires it into contract/index.ts and the devnet test.
//
// `version` selects the compiler with `compact compile +<version>`; without
// it the default compiler runs (the monorepo's examples, whose CI sets the
// default to the pin).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { contractSources } from '../lib/contract-info.mjs';
import { fail } from '../lib/template.mjs';

/** Returns the exit status of the first failed compile, or 0. */
export function compile(dir, { skipZk = false, version = null } = {}) {
  if (!fs.existsSync(path.join(dir, 'contract'))) {
    fail('run this from a project directory (one with contract/), via `npm run compile` or `npm run compile:fast`.');
  }
  const contracts = contractSources(dir);
  if (contracts.length === 0) fail('no contract/*.compact to compile.');

  for (const { name } of contracts) {
    const cmd = [
      'compile',
      ...(version ? [`+${version}`] : []),
      ...(skipZk ? ['--skip-zk'] : []),
      `contract/${name}.compact`,
      `contract/managed/${name}`,
    ];
    console.log(`• compact ${cmd.join(' ')}`);
    const r = spawnSync('compact', cmd, { cwd: dir, stdio: 'inherit' });
    if (r.error) fail(`could not run compact: ${r.error.message}`);
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}
