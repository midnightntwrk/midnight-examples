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

// Runs one package script in every workspace that has it, in parallel:
// `npm run <script> --workspaces` runs them one at a time. The root
// package.json's compile, compile:fast, typecheck, build:packages and postinstall use it;
// the test scripts stay sequential (`npm run … --workspaces --if-present`).
//
//   node scripts/each-workspace.mjs <script> [--include <glob>] [--jobs <n>] [-- <args>]
//
// --include keeps the workspaces whose package name matches <glob> (`*` is
// the only wildcard). Arguments after `--` are passed to each script. As with `yarn workspaces foreach --parallel`, which this
// replaces: at most half the CPUs by default, and each workspace's output is
// printed in one piece when it finishes. Exits 1 if any workspace failed.
// Zero dependencies — Node built-ins only.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/each-workspace.mjs <script> [--include <glob>] [--jobs <n>] [-- <args>]';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const dashes = argv.indexOf('--');
const args = dashes === -1 ? argv : argv.slice(0, dashes);
const forwarded = dashes === -1 ? [] : argv.slice(dashes + 1);
let script;
let include;
let jobs = Math.ceil(os.availableParallelism() / 2);
/** The value after the flag at args[i]: a missing one is a usage error, not "no filter". */
const valueAt = (i) => (i < args.length && !args[i].startsWith('-') ? args[i] : fail(USAGE));
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--include') include = valueAt(++i);
  else if (a === '--jobs') jobs = Number(valueAt(++i));
  else if (a.startsWith('-') || script) fail(USAGE);
  else script = a;
}
if (!script || include === '' || !(jobs >= 1)) fail(USAGE);

/** The directories the root package.json's `workspaces` globs match (`*` segments only). */
function workspaceDirs() {
  const { workspaces } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const dirs = new Set();
  for (const pattern of workspaces) {
    let found = [REPO_ROOT];
    for (const seg of pattern.split('/')) {
      found = found.flatMap((dir) =>
        seg === '*'
          ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
          : fs.existsSync(path.join(dir, seg)) ? [path.join(dir, seg)] : [],
      );
    }
    for (const dir of found) if (fs.existsSync(path.join(dir, 'package.json'))) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * The npm that ran this script (npm_execpath), so a script started with
 * `npx npm@<version>` stays on that version; plain `npm` otherwise. No `shell:`
 * option (opengrep flags any non-false value): on Windows, npm.cmd runs
 * through cmd.exe.
 */
function npmCommand(args) {
  const cli = process.env.npm_execpath;
  if (cli && /\.c?js$/.test(cli)) return [process.execPath, [cli, ...args]];
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'npm', ...args]] : ['npm', args];
}

const includeRe = include && new RegExp(`^${include.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`);
const targets = workspaceDirs()
  .map((dir) => ({ dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) }))
  .filter(({ pkg }) => pkg.scripts?.[script] && (!includeRe || includeRe.test(pkg.name)));
if (targets.length === 0) fail(`no workspace has a "${script}" script${include ? ` and a name matching ${include}` : ''}`);

/** Runs `npm run <script>` in `dir`; prints its output, prefixed with the name, once it exits. */
function runOne({ dir, pkg }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(...npmCommand(['run', script, ...(forwarded.length ? ['--', ...forwarded] : [])]), { cwd: dir });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => {
      const prefix = `[${pkg.name}] `;
      const body = output.trimEnd();
      if (body) process.stdout.write(`${body.split('\n').map((l) => prefix + l).join('\n')}\n`);
      const s = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${code === 0 ? '✔' : '✖'} ${pkg.name} ${script} (${s}s)`);
      resolve(code === 0 ? null : pkg.name);
    });
  });
}

const queue = [...targets];
const failed = [];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const name = await runOne(queue.shift());
      if (name) failed.push(name);
    }
  }),
);
if (failed.length) fail(`${script} failed in ${failed.sort().join(', ')}`);
console.log(`✔ ${script} passed in ${targets.length} workspace${targets.length === 1 ? '' : 's'}`);
