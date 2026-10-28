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

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.mjs';
import { blockfrostProjectId, checkNetwork, redact, runNetworkChecks } from '../src/commands/doctor.mjs';
import { loadToolchain } from '../src/lib/toolchain.mjs';
import { cleanup, tmpDir } from './helpers.mjs';

afterEach(cleanup);

const TC = { ...loadToolchain(), images: { ...loadToolchain().images, 'midnightntwrk/proof-server': '8.1.3' } };
const PROJECT_ID = 'preprod-test-project';

/** A directory with a .git, so the .env.preprod search stops there. */
function repo(envPreprod = null) {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.git'));
  if (envPreprod !== null) fs.writeFileSync(path.join(dir, '.env.preprod'), envPreprod);
  return dir;
}

/**
 * A stand-in for fetch that answers like a node (JSON-RPC), an indexer
 * (GraphQL) and a proof server (/version). `status` forces an HTTP status
 * per kind; a `proof` Error is thrown as a refused connection.
 */
function fakeFetch({ nodeHeight = 1000, indexerHeight = 998, proof = '8.1.3', status = {} } = {}) {
  const urls = [];
  const fetch = async (url, init = {}) => {
    urls.push(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const kind = body?.method ? 'node' : body?.query ? 'indexer' : 'proof';
    if (kind === 'proof' && proof instanceof Error) throw proof;
    const code = status[kind] ?? 200;
    const result = {
      system_version: '1.0.400-87c0fbdb',
      state_getRuntimeVersion: { specVersion: 1000300 },
      chain_getHeader: { number: `0x${nodeHeight.toString(16)}` },
    };
    const json =
      kind === 'node' ? { jsonrpc: '2.0', id: 1, result: result[body.method] } : { data: { block: { height: indexerHeight } } };
    return { ok: code < 400, status: code, json: async () => json, text: async () => `${proof}\n` };
  };
  return { fetch, urls };
}

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

describe('mnkit doctor --network', () => {
  it('passes a healthy preview, showing the node and runtime versions', async () => {
    const { fetch, urls } = fakeFetch();
    const checks = await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch });
    expect(checks.map((c) => c.name)).toEqual(['node RPC', 'indexer', 'indexer lag', 'proof server 8.1.3']);
    expect(checks.every((c) => c.ok && !c.warn)).toBe(true);
    const c = byName(checks);
    expect(c['node RPC'].detail).toBe('node 1.0.400-87c0fbdb, runtime spec 1000300, block 1000');
    expect(c['indexer lag'].detail).toBe('2 block(s) behind the node');
    expect(urls).toContain(TC.networks.preview.node);
    expect(urls).toContain(TC.networks.preview.indexer);
    expect(urls).toContain('http://127.0.0.1:6300/version');
  });

  it(`warns when the indexer is more than 100 blocks behind the node`, async () => {
    const { fetch } = fakeFetch({ nodeHeight: 1000, indexerHeight: 850 });
    const lag = byName(await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch }))['indexer lag'];
    expect(lag).toMatchObject({ ok: true, warn: true });
    expect(lag.detail).toMatch(/^150 blocks behind the node: wallets will sync slowly/);
  });

  it('fails an unreachable node or indexer without a lag row', async () => {
    const { fetch } = fakeFetch({ status: { node: 502 } });
    const c = byName(await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch }));
    expect(c['node RPC']).toMatchObject({ ok: false, detail: `${TC.networks.preview.node}: HTTP 502` });
    expect(c.indexer.ok).toBe(true);
    expect(c['indexer lag']).toBeUndefined();
  });

  it('fails an unreachable proof server and says how to start one', async () => {
    const { fetch } = fakeFetch({ proof: refused() });
    const ps = byName(await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch }))['proof server 8.1.3'];
    expect(ps.ok).toBe(false);
    expect(ps.detail).toMatch(/127\.0\.0\.1:6300: ECONNREFUSED\. Start one with `npm run proof:up`/);
  });

  it('fails a proof server from another major release, and warns on any other difference', async () => {
    const major = byName(await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch: fakeFetch({ proof: '7.0.0' }).fetch }));
    expect(major['proof server 8.1.3'].ok).toBe(false);
    expect(major['proof server 8.1.3'].detail).toMatch(/runs 7\.0\.0: transactions it proves will fail.*create-mn-app\/issues\/40/);
    const patch = byName(await runNetworkChecks('preview', { tc: TC, dir: repo(), env: {}, fetch: fakeFetch({ proof: '8.1.0' }).fetch }));
    expect(patch['proof server 8.1.3']).toMatchObject({ ok: true, warn: true });
  });

  it('checks the proof server at MIDNIGHT_PROOF_SERVER', async () => {
    const { fetch, urls } = fakeFetch();
    await runNetworkChecks('preview', { tc: TC, dir: repo(), env: { MIDNIGHT_PROOF_SERVER: 'http://prover:6300/' }, fetch });
    expect(urls).toContain('http://prover:6300/version');
  });

  it('fails preprod without a Blockfrost project ID and skips the node and indexer', async () => {
    const { fetch, urls } = fakeFetch();
    const checks = await runNetworkChecks('preprod', { tc: TC, dir: repo(), env: {}, fetch });
    expect(checks.map((c) => c.name)).toEqual(['Blockfrost project ID', 'proof server 8.1.3']);
    expect(checks[0]).toMatchObject({ ok: false });
    expect(checks[0].detail).toMatch(/BLOCKFROST_PROJECT_ID is not set/);
    expect(urls).toEqual(['http://127.0.0.1:6300/version']);
  });

  it("reads the project ID from .env.preprod, sends it, and never prints it", async () => {
    const { fetch, urls } = fakeFetch({ status: { indexer: 403 } });
    const dir = repo(`BLOCKFROST_PROJECT_ID=${PROJECT_ID}\n`);
    const checks = await runNetworkChecks('preprod', { tc: TC, dir, env: {}, fetch });
    const c = byName(checks);
    expect(c['Blockfrost project ID']).toMatchObject({ ok: true, detail: 'set, from .env.preprod' });
    expect(urls).toContain(`${TC.networks.preprod.node}?project_id=${PROJECT_ID}`);
    expect(c.indexer.ok).toBe(false);
    expect(c.indexer.detail).toMatch(/Blockfrost rejected the project ID \(403\): it is wrong, or for another network/);
    expect(JSON.stringify(checks)).not.toContain(PROJECT_ID);
  });

  it("prefers BLOCKFROST_PROJECT_ID from the environment, and reads a monorepo example's from the repo root", () => {
    const dir = repo(`BLOCKFROST_PROJECT_ID=${PROJECT_ID}\n`);
    const sub = path.join(dir, 'examples', 'app');
    fs.mkdirSync(sub, { recursive: true });
    expect(blockfrostProjectId(sub, {})).toEqual({ id: PROJECT_ID, from: path.join(dir, '.env.preprod') });
    expect(blockfrostProjectId(sub, { BLOCKFROST_PROJECT_ID: ' envkey ' })).toEqual({ id: 'envkey', from: 'the environment' });
    expect(blockfrostProjectId(repo(), {})).toBeNull();
    expect(blockfrostProjectId(repo('OTHER=1\n'), {})).toBeNull();
  });

  it("reads a standalone project's own env files, as scripts/deploy.ts does, and not a parent's", () => {
    const dir = repo(`BLOCKFROST_PROJECT_ID=${PROJECT_ID}\n`);
    const app = path.join(dir, 'app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'mnkit.json'), '{}');
    expect(blockfrostProjectId(app, {})).toBeNull();

    fs.writeFileSync(path.join(app, '.env'), 'BLOCKFROST_PROJECT_ID=from-env\n');
    expect(blockfrostProjectId(app, {})).toEqual({ id: 'from-env', from: path.join(app, '.env') });
    fs.writeFileSync(path.join(app, '.env.preprod'), 'BLOCKFROST_PROJECT_ID=from-preprod\n');
    fs.writeFileSync(path.join(app, '.env.preprod.local'), 'BLOCKFROST_PROJECT_ID=from-local\n');
    expect(blockfrostProjectId(app, {})).toEqual({ id: 'from-local', from: path.join(app, '.env.preprod.local') });
  });

  it("checks the proof server named in the network's env file, unless the environment sets one", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.env.preview'), 'MIDNIGHT_PROOF_SERVER=http://remote-prover:6300\n');
    const file = fakeFetch();
    await runNetworkChecks('preview', { tc: TC, dir, env: {}, fetch: file.fetch });
    expect(file.urls).toContain('http://remote-prover:6300/version');

    const set = fakeFetch();
    await runNetworkChecks('preview', { tc: TC, dir, env: { MIDNIGHT_PROOF_SERVER: 'http://mine:6300' }, fetch: set.fetch });
    expect(set.urls).toContain('http://mine:6300/version');
    expect(set.urls).not.toContain('http://remote-prover:6300/version');
  });

  it('redacts project IDs in URLs', () => {
    expect(redact(`https://x.io/api?project_id=${PROJECT_ID}&a=1 and wss://y.io?project_id=${PROJECT_ID}`)).toBe(
      'https://x.io/api?project_id=<redacted>&a=1 and wss://y.io?project_id=<redacted>',
    );
  });

  it('refuses mainnet and unknown networks', async () => {
    expect(() => checkNetwork('mainnet', TC)).toThrow("mnkit doesn't check mainnet");
    expect(() => checkNetwork('devnet', TC)).toThrow("unknown network 'devnet'. Networks: local, preview, preprod.");
    await expect(main(['doctor', '--network', 'mainnet'])).rejects.toThrow("doesn't check mainnet");
    await expect(main(['doctor', 'preview'])).rejects.toThrow('mnkit doctor takes no arguments');
  });
});
