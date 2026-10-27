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

// `mnkit doctor [--network local|preview|preprod]`: checks what a project
// needs before its first compile and devnet run, and says how to fix each
// problem. With a network it also checks that network's node, indexer and the
// proof server: a first look at whether the network side is healthy before
// digging into your own code. Run it any time; it changes nothing.

import net from 'node:net';
import path from 'node:path';
import { resolveCompact } from '../lib/compact-install.mjs';
import { loadNetworkEnv } from '../lib/env.mjs';
import { checkCompactVersion, checkDocker } from '../lib/preflight.mjs';
import { fail } from '../lib/template.mjs';
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

/** An indexer this many blocks behind its node makes wallets sync slowly or look stuck. */
export const MAX_INDEXER_LAG = 100;

const TIMEOUT_MS = 10_000;

/** Hides a Blockfrost project ID in `text`, so it can be printed. */
export const redact = (text) => text.replace(/([?&]project_id=)[^&\s]*/g, '$1<redacted>');

const withProjectId = (url, id) => (id ? `${url}${url.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(id)}` : url);

/**
 * The Blockfrost project ID and where it came from: the environment's
 * BLOCKFROST_PROJECT_ID, else the project's preprod env files (lib/env.mjs:
 * the ones scripts/deploy.ts reads), or null.
 */
export function blockfrostProjectId(dir, env = process.env) {
  const { env: merged, from } = loadNetworkEnv(dir, 'preprod', env);
  const id = merged.BLOCKFROST_PROJECT_ID?.trim();
  if (!id) return null;
  return { id, from: from.BLOCKFROST_PROJECT_ID ?? 'the environment' };
}

/** Why a request failed, in words: a 403 from Blockfrost is a key problem, not an outage. */
function why(err, network) {
  if (err.status === 403 && network === 'preprod') {
    return 'Blockfrost rejected the project ID (403): it is wrong, or for another network';
  }
  if (err.status) return `HTTP ${err.status}`;
  if (err.name === 'TimeoutError') return `no answer in ${TIMEOUT_MS / 1000}s`;
  return err.cause?.code ?? err.cause?.message ?? err.message;
}

async function request(fetch, url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res;
}

const postJson = async (fetch, url, body) =>
  (await request(fetch, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

async function rpc(fetch, url, method) {
  const r = await postJson(fetch, url, { id: 1, jsonrpc: '2.0', method, params: [] });
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

/**
 * Checks `network` (a key of toolchain.json `networks`) from this machine;
 * returns rows like runChecks(). Preprod first needs a Blockfrost project ID;
 * every network needs a proof server whose version matches the pinned image's
 * major. Settings come from `env` over the project's env files for `network`,
 * as scripts/deploy.ts reads them. `fetch` is for tests.
 */
export async function runNetworkChecks(
  network,
  { tc = loadToolchain(), dir = process.cwd(), env = process.env, fetch = globalThis.fetch } = {},
) {
  const endpoints = tc.networks[network];
  const settings = loadNetworkEnv(dir, network, env).env;
  const checks = [];
  let projectId = null;
  if (network === 'preprod') {
    const found = blockfrostProjectId(dir, env);
    projectId = found?.id ?? null;
    checks.push({
      name: 'Blockfrost project ID',
      ok: Boolean(found),
      detail: found
        ? `set, from ${found.from === 'the environment' ? found.from : path.relative(dir, found.from) || found.from}`
        : 'BLOCKFROST_PROJECT_ID is not set: preprod goes through Blockfrost, which needs a project ID. Add it to .env.preprod or export it.',
    });
  }
  if (network !== 'preprod' || projectId) {
    const node = withProjectId(endpoints.node, projectId);
    let nodeHeight = null;
    try {
      const [version, runtime, header] = await Promise.all(
        ['system_version', 'state_getRuntimeVersion', 'chain_getHeader'].map((m) => rpc(fetch, node, m)),
      );
      nodeHeight = Number.parseInt(header.number, 16);
      checks.push({
        name: 'node RPC',
        ok: true,
        detail: `node ${version}, runtime spec ${runtime.specVersion}, block ${nodeHeight}`,
      });
    } catch (err) {
      const hint = network === 'local' ? ': start the local network with `npm run env:up`' : '';
      checks.push({ name: 'node RPC', ok: false, detail: `${endpoints.node}: ${why(err, network)}${hint}` });
    }
    let indexerHeight = null;
    try {
      const r = await postJson(fetch, withProjectId(endpoints.indexer, projectId), { query: '{ block { height } }' });
      indexerHeight = r.data?.block?.height;
      if (typeof indexerHeight !== 'number') throw new Error(r.errors?.[0]?.message ?? 'no block height in the answer');
      checks.push({ name: 'indexer', ok: true, detail: `block ${indexerHeight}` });
    } catch (err) {
      checks.push({ name: 'indexer', ok: false, detail: `${endpoints.indexer}: ${why(err, network)}` });
    }
    if (nodeHeight !== null && indexerHeight !== null) {
      const lag = Math.max(0, nodeHeight - indexerHeight);
      checks.push({
        name: 'indexer lag',
        ok: true,
        warn: lag > MAX_INDEXER_LAG,
        detail:
          lag > MAX_INDEXER_LAG
            ? `${lag} blocks behind the node: wallets will sync slowly or look stuck`
            : `${lag} block(s) behind the node`,
      });
    }
  }
  checks.push(await proofServerCheck(tc, settings, fetch));
  return checks.map((c) => ({ ...c, detail: redact(c.detail) }));
}

/** The proof server at MIDNIGHT_PROOF_SERVER, or the local one, against the pinned image. */
async function proofServerCheck(tc, env, fetch) {
  const url = env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
  const pin = tc.images['midnightntwrk/proof-server'];
  const name = `proof server ${pin}`;
  let found;
  try {
    found = (await (await request(fetch, `${url.replace(/\/+$/, '')}/version`)).text()).trim();
  } catch (err) {
    return { name, ok: false, detail: `${url}: ${why(err)}. Start one with \`npm run proof:up\`, or set MIDNIGHT_PROOF_SERVER.` };
  }
  if (found === pin) return { name, ok: true, detail: `${url} runs ${found}` };
  if (found.split('.')[0] !== pin.split('.')[0]) {
    return {
      name,
      ok: false,
      detail:
        `${url} runs ${found}: transactions it proves will fail. Restart it at ${pin} (\`npm run proof:up\`); ` +
        'see https://github.com/midnightntwrk/create-mn-app/issues/40.',
    };
  }
  return { name, ok: true, warn: true, detail: `${url} runs ${found}, not the pinned ${pin}` };
}

/** Prints check rows with ✔, ! (a warning) or ✖. */
export function printChecks(checks) {
  for (const c of checks) console.log(`${c.ok ? (c.warn ? '!' : '✔') : '✖'} ${c.name}: ${c.detail}`);
}

/** Refuses a network that toolchain.json has no endpoints for. */
export function checkNetwork(network, tc = loadToolchain()) {
  const known = Object.keys(tc.networks);
  if (network === 'mainnet') fail(`mnkit doesn't check mainnet: it has no mainnet config. Networks: ${known.join(', ')}.`);
  if (!known.includes(network)) fail(`unknown network '${network}'. Networks: ${known.join(', ')}.`);
}

/** Prints the checks (and `network`'s, when given); returns 1 if any failed. */
export async function doctor({ network = null } = {}) {
  if (network !== null) checkNetwork(network);
  const local = await runChecks();
  const remote = network !== null ? await runNetworkChecks(network) : [];
  printChecks([...local, ...remote]);
  const failed = [...local, ...remote].filter((c) => !c.ok);
  const before = network !== null ? `compiling and testing on ${network}` : 'compiling and testing';
  console.log(failed.length ? `\n${failed.length} problem(s) to fix before ${before}.` : '\nReady.');
  return failed.length ? 1 : 0;
}
