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

// mnkit deploy: the checks before it runs the project's scripts/deploy.ts,
// the compile-first rule, and how it calls vite-node. The deploy itself needs
// a network; scripts/mnkit-e2e.sh --devnet runs it against a local one.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.mjs';
import { packageSpecs } from '../src/commands/init.mjs';
import { deploy, deployArgsTodos } from '../src/commands/deploy.mjs';
import { renderExample } from '../src/lib/scaffold.mjs';
import { writeFiles } from '../src/lib/template.mjs';
import { mnkitVersion } from '../src/lib/toolchain.mjs';
import { TEMPLATE_DIR, cleanup, placeCompiled, tmpDir } from './helpers.mjs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A standalone hello-world with npm install done (a stand-in vite-node), compiled with keys unless `compiled: false`. */
function project({ compiled = true } = {}) {
  const dir = tmpDir();
  const version = mnkitVersion();
  writeFiles(dir, renderExample(TEMPLATE_DIR, { name: 'hello-world', mode: 'standalone', specs: packageSpecs(version), mnkitVersion: version }));
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'vite-node'), '');
  if (compiled) {
    placeCompiled('hello-world', dir);
    fs.mkdirSync(path.join(dir, 'contract', 'managed', 'hello-world', 'keys'));
  }
  return dir;
}

/** Stand-ins for compile, the network checks and spawnSync that record their calls. */
function stubs({ compileStatus = 0, deployStatus = 0, networkOk = true } = {}) {
  const calls = { compile: [], network: [], spawn: [] };
  return {
    calls,
    compiler: async (dir, opts) => {
      calls.compile.push(opts);
      return compileStatus;
    },
    networkChecks: async (network) => {
      calls.network.push(network);
      return [{ name: 'node RPC', ok: networkOk, detail: networkOk ? 'node 1.0.400' : 'HTTP 502' }];
    },
    spawn: (cmd, args, opts) => {
      calls.spawn.push({ cmd, args, network: opts.env.MIDNIGHT_NETWORK, cwd: opts.cwd });
      return { status: deployStatus };
    },
  };
}

describe('mnkit deploy', () => {
  it('runs scripts/deploy.ts with vite-node on the chosen network', async () => {
    const dir = project();
    const s = stubs();
    expect(await deploy(dir, { network: 'preprod', ...s })).toBe(0);
    expect(s.calls.network).toEqual(['preprod']);
    expect(s.calls.compile).toEqual([]);
    expect(s.calls.spawn).toEqual([
      { cmd: path.join(dir, 'node_modules', '.bin', 'vite-node'), args: ['scripts/deploy.ts'], network: 'preprod', cwd: dir },
    ]);
  });

  it('stops before compiling or deploying when a network check fails', async () => {
    const s = stubs({ networkOk: false });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await deploy(project({ compiled: false }), { network: 'preview', ...s })).toBe(1);
    expect(s.calls.network).toEqual(['preview']);
    expect(s.calls.compile).toEqual([]);
    expect(s.calls.spawn).toEqual([]);
  });

  it('does not run the network checks for a local deploy', async () => {
    const s = stubs();
    expect(await deploy(project(), { ...s })).toBe(0);
    expect(s.calls.network).toEqual([]);
  });

  it('passes the contract name to the script and returns its exit status', async () => {
    const s = stubs({ deployStatus: 3 });
    expect(await deploy(project(), { contract: 'tip-token', ...s })).toBe(3);
    expect(s.calls.spawn[0]).toMatchObject({ args: ['scripts/deploy.ts', 'tip-token'], network: 'local' });
  });

  it('compiles first when there are no keys, and stops when that fails', async () => {
    const dir = project();
    fs.rmSync(path.join(dir, 'contract', 'managed', 'hello-world', 'keys'), { recursive: true });
    const ok = stubs();
    expect(await deploy(dir, { version: '0.31.0', install: false, ...ok })).toBe(0);
    expect(ok.calls.compile).toEqual([{ version: '0.31.0', install: false }]);
    expect(ok.calls.spawn).toHaveLength(1);

    const broken = stubs({ compileStatus: 2 });
    expect(await deploy(project({ compiled: false }), broken)).toBe(2);
    expect(broken.calls.spawn).toEqual([]);
  });

  it('refuses mainnet and unknown networks', async () => {
    const dir = project();
    await expect(deploy(dir, { network: 'mainnet', ...stubs() })).rejects.toThrow(/doesn't deploy to mainnet/);
    await expect(deploy(dir, { network: 'devnet', ...stubs() })).rejects.toThrow("unknown network 'devnet'");
  });

  it('says how to get the files it needs', async () => {
    const without = (rel) => {
      const dir = project();
      fs.rmSync(path.join(dir, ...rel.split('/')), { recursive: true });
      return deploy(dir, stubs());
    };
    await expect(without('mnkit.json')).rejects.toThrow('one with a mnkit.json');
    await expect(without('scripts/deploy.ts')).rejects.toThrow('Run `npx mnkit upgrade` to add it.');
    await expect(without('contract/deploy-args.ts')).rejects.toThrow('then `npx mnkit derive`');
    await expect(without('node_modules')).rejects.toThrow('Run `npm install`');
  });

  /** A project whose deploy-args.ts has one TODO placeholder. */
  function withTodo() {
    const dir = project();
    expect(deployArgsTodos(dir)).toEqual([]);
    const file = path.join(dir, 'contract', 'deploy-args.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('initialPrivateState: {}', 'initialPrivateState: {} /* TODO secret */'));
    return dir;
  }

  it('warns about TODO placeholders left in contract/deploy-args.ts on local', async () => {
    const dir = withTodo();
    expect(deployArgsTodos(dir)).toEqual(['initialPrivateState: {} /* TODO secret */,']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = stubs();
    expect(await deploy(dir, s)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('has 1 TODO placeholder(s)'));
    expect(s.calls.spawn).toHaveLength(1);
  });

  it('refuses TODO placeholders off local before any network call, unless --allow-todos', async () => {
    const dir = withTodo();
    const s = stubs();
    await expect(deploy(dir, { network: 'preview', ...s })).rejects.toThrow(
      /1 TODO placeholder\(s\):\n {4}initialPrivateState: \{\} \/\* TODO secret \*\/,\n.*--allow-todos/,
    );
    expect(s.calls.network).toEqual([]);
    expect(s.calls.spawn).toEqual([]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const allowed = stubs();
    expect(await deploy(dir, { network: 'preprod', allowTodos: true, ...allowed })).toBe(0);
    expect(allowed.calls.spawn).toHaveLength(1);
  });

  it('takes the contract as its one argument', async () => {
    // Outside a project, so one name gets as far as the project check.
    await expect(main(['deploy', 'tip-token'])).rejects.toThrow('one with a mnkit.json');
    await expect(main(['deploy', 'tip-token', 'private-tip-jar'])).rejects.toThrow('takes at most one contract');
    await expect(main(['deploy', '--contract', 'tip-token'])).rejects.toThrow("Unknown option '--contract'");
  });
});
