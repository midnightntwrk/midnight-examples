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

// `mnkit doctor`: checks what a project needs before its first compile and
// devnet run, and says how to fix each problem. Run it any time; it changes
// nothing.

import net from 'node:net';
import { resolveCompact } from '../lib/compact-install.mjs';
import { checkCompactVersion, checkDocker } from '../lib/preflight.mjs';
import { loadToolchain } from '../lib/toolchain.mjs';

/** The local devnet's ports (compose.yml): proof server, node, indexer. */
export const DEVNET_PORTS = { 6300: 'proof server', 9944: 'node', 8088: 'indexer' };

const portFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });

/**
 * Runs every check; returns [{ name, ok, detail, warn }]. A port in use is a
 * warning, not a failure: it may be this project's own network. So is a
 * missing Compact CLI or compiler: `mnkit compile` installs them.
 */
export async function runChecks(tc = loadToolchain()) {
  const major = Number(process.versions.node.split('.')[0]);
  const checks = [
    {
      name: `Node ${tc.node} or later`,
      ok: major >= Number(tc.node),
      detail: major >= Number(tc.node) ? `Node ${process.versions.node}` : `Node ${process.versions.node} is too old. Install Node ${tc.node}+.`,
    },
  ];
  const pin = tc.compact.compiler;
  const missing = !resolveCompact()
    ? `the \`compact\` CLI is not installed: \`npm run compile\` installs Compact CLI ${tc.compact.cli} and compiler ${pin}`
    : checkCompactVersion(pin)
      ? `not installed: \`npm run compile\` installs it, or run \`compact update ${pin} --no-set-default\``
      : null;
  checks.push({ name: `Compact compiler ${pin}`, ok: true, warn: Boolean(missing), detail: missing || 'installed' });
  const docker = checkDocker();
  checks.push({ name: 'Docker', ok: !docker, detail: docker ?? 'daemon reachable' });
  for (const [port, what] of Object.entries(DEVNET_PORTS)) {
    const free = await portFree(Number(port));
    checks.push({
      name: `port ${port} (${what})`,
      ok: true,
      warn: !free,
      detail: free ? 'free' : 'in use: a local network is already running, or another program has it',
    });
  }
  return checks;
}

/** Prints the checks; returns 1 if any failed. */
export async function doctor() {
  const checks = await runChecks();
  for (const c of checks) console.log(`${c.ok ? (c.warn ? '!' : '✔') : '✖'} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n${failed.length} problem(s) to fix before compiling and testing.` : '\nReady.');
  return failed.length ? 1 : 0;
}
