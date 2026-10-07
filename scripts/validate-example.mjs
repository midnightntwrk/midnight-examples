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

// The devnet gate for one example: compile → env:up → wait:dust → test:local,
// then env:down. Every example's `validate` script runs this from its own
// directory:
//
//   yarn validate [--keep-net]
//
// It exits with the status of the first step that failed, so a red test run
// is never reported as a pass. (The old one-liner `… && yarn test:local;
// yarn env:down` exited with env:down's status, which is almost always 0.)
//
//   --keep-net   leave the network running afterwards. `env:up` is a no-op on
//                a healthy network, so a fix loop of `yarn validate
//                --keep-net` skips the network restart; run `yarn env:down`
//                when done.
//
// `compile` is skipped when every contract/managed/*/compiler/contract-info.json
// is newer than every .compact under contract/, because a full compile
// regenerates the proving keys and is the slowest step after the tests.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from './lib/preflight.mjs';
import { fail } from './lib/template.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_DIR = process.cwd();

const KNOWN_FLAGS = new Set(['--keep-net']);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
if (unknown.length > 0) fail(`unknown argument(s): ${unknown.join(' ')}. Usage: yarn validate [--keep-net]`);
const keepNet = args.includes('--keep-net');

if (!fs.existsSync(path.join(EXAMPLE_DIR, 'compose.yml'))) {
  fail('run this from an example directory (one with a compose.yml), via `yarn validate`.');
}
preflight(REPO_ROOT, { compact: true, docker: true });

/** Every file under `dir` matching `pred`, skipping managed/ and node_modules/. */
function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'managed' || entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, pred, out);
    else if (pred(entry.name)) out.push(p);
  }
  return out;
}

function compileIsStale() {
  const contractDir = path.join(EXAMPLE_DIR, 'contract');
  const managedDir = path.join(contractDir, 'managed');
  const infos = fs.existsSync(managedDir)
    ? fs
        .readdirSync(managedDir)
        .map((d) => path.join(managedDir, d, 'compiler', 'contract-info.json'))
        .filter((p) => fs.existsSync(p))
    : [];
  if (infos.length === 0) return true;
  // `yarn compile:fast` (--skip-zk) writes the same JS and contract-info.json
  // but no proving keys, and the devnet tests need them.
  const missingKeys = infos.some((p) => {
    const managed = path.dirname(path.dirname(p));
    const proves = JSON.parse(fs.readFileSync(p, 'utf8')).circuits?.some((c) => c.proof);
    return proves && !fs.existsSync(path.join(managed, 'keys'));
  });
  if (missingKeys) return true;
  const newestSource = Math.max(...walk(contractDir, (n) => n.endsWith('.compact')).map((p) => fs.statSync(p).mtimeMs));
  const oldestOutput = Math.min(...infos.map((p) => fs.statSync(p).mtimeMs));
  return newestSource > oldestOutput;
}

function run(script) {
  console.log(`\n▶ yarn ${script}`);
  const r = spawnSync('yarn', [script], { stdio: 'inherit', cwd: EXAMPLE_DIR });
  return r.status ?? 1;
}

const steps = [...(compileIsStale() ? ['compile'] : []), 'env:up', 'wait:dust', 'test:local'];
if (!steps.includes('compile')) console.log('• compile skipped: contract/managed has proving keys and is newer than every .compact source');

let failed = null;
let status = 0;
try {
  for (const step of steps) {
    status = run(step);
    if (status !== 0) {
      failed = step;
      break;
    }
  }
} finally {
  if (failed && failed !== 'compile') {
    // Same as CI: keep the service logs, which env:down deletes with the containers.
    fs.mkdirSync(path.join(EXAMPLE_DIR, 'logs'), { recursive: true });
    const logs = spawnSync('docker', ['compose', 'logs', '--no-color', '--timestamps'], { cwd: EXAMPLE_DIR });
    fs.writeFileSync(path.join(EXAMPLE_DIR, 'logs', 'compose.log'), logs.stdout ?? '');
  }
  if (!keepNet && failed !== 'compile') run('env:down');
}

if (failed) {
  const logNote = failed === 'compile' ? '' : ' Service logs: logs/compose.log.';
  console.error(`\n✖ validate failed at \`${failed}\` (exit ${status}).${logNote}`);
  process.exit(status);
}
console.log(`\n✔ validate passed${keepNet ? ' (network left running; `yarn env:down` when done)' : ''}`);
