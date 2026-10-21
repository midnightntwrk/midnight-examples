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

// Regenerates the compiler output the engine unit tests read:
//
//   yarn fixtures:regen           rewrite compiled/
//   yarn fixtures:regen --check   fail if compiled/ is stale
//
// Each fixture is <fixture>/contract/*.compact, copied from an example. Only
// the two files the generators read are kept, under <fixture>/compiled/<c>/
// (not contract/managed/, which .gitignore drops):
//   compiler/contract-info.json → compiled/<c>/contract-info.json
//   contract/index.d.ts         → compiled/<c>/index.d.ts
// --check compiles into a temp dir and compares, so a compiler bump that
// changes either file shows up as a failing check instead of a silent derive
// change. Needs the pinned compiler (toolchain.json) as the default.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSources } from '../../src/lib/contract-info.mjs';
import { checkCompact } from '../../src/lib/preflight.mjs';

const FIXTURES = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(FIXTURES, '..', '..', '..', '..');
const check = process.argv.includes('--check');

const problem = checkCompact(REPO_ROOT);
if (problem) {
  console.error(`✖ ${problem}`);
  process.exit(1);
}

const KEPT = [
  ['compiler/contract-info.json', 'contract-info.json'],
  ['contract/index.d.ts', 'index.d.ts'],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkit-fixtures-'));
const stale = [];
try {
  for (const fixture of fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = path.join(FIXTURES, fixture.name);
    for (const { name, file } of contractSources(dir)) {
      const out = path.join(tmp, fixture.name, name);
      const r = spawnSync('compact', ['compile', '--skip-zk', file, out], { encoding: 'utf8' });
      if (r.status !== 0) {
        console.error(`✖ compact compile ${path.relative(REPO_ROOT, file)} failed:\n${r.stderr || r.stdout}`);
        process.exit(1);
      }
      for (const [from, to] of KEPT) {
        const fresh = fs.readFileSync(path.join(out, from), 'utf8');
        const dest = path.join(dir, 'compiled', name, to);
        if (check) {
          if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== fresh) stale.push(path.relative(REPO_ROOT, dest));
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, fresh);
          console.log(`• ${path.relative(REPO_ROOT, dest)}`);
        }
      }
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (stale.length > 0) {
  console.error(
    `✖ ${stale.length} fixture file(s) differ from what the pinned compiler emits:\n  - ${stale.join('\n  - ')}\n` +
      'Run yarn fixtures:regen and review the diff: the generators may need updating.',
  );
  process.exit(1);
}
if (check) console.log('✓ compiled fixtures match the pinned compiler');
