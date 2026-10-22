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

// Installs the Compact toolchain mnkit pins, so `mnkit compile` works on a
// machine that has neither the `compact` CLI nor the pinned compiler.
// Zero dependencies — Node built-ins only.
//
// The CLI comes from the official installer of the pinned release
// (toolchain.json `compact.cli`). The script is downloaded, checked against
// `compact.installerSha256` and only then run; it checks the archive it
// fetches against hashes of its own, so pinning the script pins the binaries.
// The compiler comes from `compact update <pin> --no-set-default`, which
// leaves the developer's default compiler alone; on a machine with no default
// compiler yet, plain `compact update <pin>` makes the pin the default.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCompactVersion } from './preflight.mjs';
import { fail } from './template.mjs';

export const COMPACT_DOCS = 'https://docs.midnight.network/getting-started/installation';

export const installerUrl = (cli) =>
  `https://github.com/midnightntwrk/compact/releases/download/compact-v${cli}/compact-installer.sh`;

/** Where the installer puts `compact`, in the installer's own order. */
export function compactInstallDirs(env = process.env) {
  return [
    env.COMPACT_INSTALL_DIR,
    env.XDG_BIN_HOME,
    env.XDG_DATA_HOME && path.join(env.XDG_DATA_HOME, '..', 'bin'),
    path.join(env.HOME || os.homedir(), '.local', 'bin'),
  ].filter(Boolean);
}

/**
 * True when `compact` can be run. A fresh install isn't on this process's
 * PATH yet (the installer edits shell profiles), so an install directory that
 * has it goes on the front of PATH, for this process and the commands it runs.
 */
export function resolveCompact() {
  if (!spawnSync('compact', ['--version'], { stdio: 'ignore' }).error) return true;
  const dir = compactInstallDirs().find((d) => fs.existsSync(path.join(d, 'compact')));
  if (!dir) return false;
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
  return true;
}

/** Downloads, verifies and runs the pinned Compact CLI installer. `url` and `sha256` are for tests. */
export async function installCompactCli(tc, { url = installerUrl(tc.compact.cli), sha256 = tc.compact.installerSha256 } = {}) {
  if (process.platform === 'win32') fail(`the Compact CLI doesn't run on Windows. Use WSL: ${COMPACT_DOCS}`);
  console.log(`• Installing the Compact CLI ${tc.compact.cli} from ${url}`);
  let body;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    fail(`could not download the Compact CLI installer (${err.message}). Install the CLI yourself: ${COMPACT_DOCS}`);
  }
  const got = crypto.createHash('sha256').update(body).digest('hex');
  if (got !== sha256) {
    fail(
      `the Compact CLI installer has sha256 ${got}, but mnkit pins ${sha256}. Not running it. Install the CLI yourself: ${COMPACT_DOCS}`,
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkit-compact-'));
  try {
    const file = path.join(tmp, 'compact-installer.sh');
    fs.writeFileSync(file, body);
    const r = spawnSync('sh', [file, '--quiet'], { stdio: 'inherit' });
    if (r.error) fail(`could not run the Compact CLI installer: ${r.error.message}`);
    if (r.status !== 0) fail(`the Compact CLI installer failed (exit ${r.status}). Install the CLI yourself: ${COMPACT_DOCS}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!resolveCompact()) {
    fail(`the Compact CLI installer finished, but no \`compact\` is in ${compactInstallDirs().join(', ')}.`);
  }
  console.log(`✔ Compact CLI ${tc.compact.cli} installed. Open a new shell to have \`compact\` on your PATH.`);
}

/**
 * Makes compiler `pin` runnable as `compact compile +<pin>`: installs the
 * Compact CLI and then the compiler when missing, unless `install` is false,
 * in which case it fails saying what to install. `installer` overrides the
 * installer's url and sha256 (tests).
 */
export async function ensureCompiler(pin, tc, { install = true, installer } = {}) {
  const offer = 'or drop --no-install (and MNKIT_NO_INSTALL) to let mnkit install it';
  if (!resolveCompact()) {
    if (!install) fail(`the \`compact\` CLI is not on PATH. Install it (${COMPACT_DOCS}), ${offer}.`);
    await installCompactCli(tc, installer);
  }
  if (!checkCompactVersion(pin)) return;
  if (!install) fail(`Compact compiler ${pin} is not installed. Run \`compact update ${pin} --no-set-default\`, ${offer}.`);
  const hasDefault = spawnSync('compact', ['compile', '--version'], { stdio: 'ignore' }).status === 0;
  const args = ['update', pin, ...(hasDefault ? ['--no-set-default'] : [])];
  console.log(
    `• Installing Compact compiler ${pin} (${hasDefault ? 'your default compiler is unchanged' : 'as the default: none was set'})`,
  );
  const r = spawnSync('compact', args, { stdio: 'inherit' });
  if (r.error || r.status !== 0) fail(`\`compact ${args.join(' ')}\` failed${r.error ? `: ${r.error.message}` : ''}.`);
  const problem = checkCompactVersion(pin);
  if (problem) fail(problem);
}
