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

// `mnkit compile` installing the pinned toolchain, against a fake `compact`
// (a shell script that logs its arguments) and a fake installer served from
// localhost. No network, and the real ~/.compact is never touched: HOME and
// PATH point into a temp dir.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../src/commands/compile.mjs';
import { runChecks } from '../src/commands/doctor.mjs';
import { loadToolchain } from '../src/lib/toolchain.mjs';
import { PKG_ROOT, cleanup, tmpDir } from './helpers.mjs';

const PIN = loadToolchain().compact.compiler;
const BIN = path.join(PKG_ROOT, 'bin', 'mnkit.mjs');

// `compile +<v> …` fails until `update <v> …` has run, and `compile
// --version` until some compiler is the default (`update` without
// --no-set-default); a plain compile writes <out>/compiled.
const FAKE_COMPACT = `#!/bin/sh
echo "$*" >> "$FAKE_COMPACT_LOG"
case "$1" in
  --version) echo 'compact 0.5.3' ;;
  update)
    touch "$FAKE_COMPACT_STATE/$2"
    [ "$3" = --no-set-default ] || echo "$2" > "$FAKE_COMPACT_STATE/default" ;;
  compile)
    shift
    v=
    case "$1" in +*) v=\${1#+}; shift ;; esac
    if [ -n "$v" ] && [ ! -e "$FAKE_COMPACT_STATE/$v" ]; then echo "Error: Couldn't find compiler ($v)" >&2; exit 1; fi
    if [ "$1" = --version ]; then
      [ -n "$v" ] || v=$(cat "$FAKE_COMPACT_STATE/default" 2> /dev/null) || { echo 'No default compiler set' >&2; exit 1; }
      echo "$v"; exit 0
    fi
    [ "$1" = --skip-zk ] && shift
    mkdir -p "$2" && : > "$2/compiled" ;;
  *) exit 2 ;;
esac
`;

// Installs the fake compact where the real installer would: $XDG_BIN_HOME.
const FAKE_INSTALLER = `#!/bin/sh
echo "$*" > "$FAKE_COMPACT_STATE/installer-args"
mkdir -p "$XDG_BIN_HOME" && cp "$FAKE_COMPACT_SRC" "$XDG_BIN_HOME/compact" && chmod +x "$XDG_BIN_HOME/compact"
`;

const ENV_KEYS = ['PATH', 'HOME', 'XDG_BIN_HOME', 'XDG_DATA_HOME', 'COMPACT_INSTALL_DIR', 'MNKIT_NO_INSTALL'];
const ENV_KEYS_FAKE = ['FAKE_COMPACT_LOG', 'FAKE_COMPACT_STATE', 'FAKE_COMPACT_SRC'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries([...ENV_KEYS, ...ENV_KEYS_FAKE].map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  cleanup();
});

/**
 * A project with one contract, and a machine that has the fake `compact` on
 * PATH (`cli`), compiler PIN installed (`compiler`) and compiler `default` as
 * its default. Sets process.env.
 */
function machine({ cli = true, compiler = false, default: dflt = cli ? '0.30.0' : null } = {}) {
  const root = tmpDir();
  const dirs = Object.fromEntries(['bin', 'home', 'state', 'xdg-bin'].map((d) => [d, path.join(root, d)]));
  for (const d of ['bin', 'home', 'state']) fs.mkdirSync(dirs[d]);
  const src = path.join(root, 'fake-compact');
  fs.writeFileSync(src, FAKE_COMPACT, { mode: 0o755 });
  if (cli) fs.copyFileSync(src, path.join(dirs.bin, 'compact'));
  if (compiler) fs.writeFileSync(path.join(dirs.state, PIN), '');
  if (dflt) {
    fs.writeFileSync(path.join(dirs.state, dflt), '');
    fs.writeFileSync(path.join(dirs.state, 'default'), dflt);
  }
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'contract'), { recursive: true });
  fs.writeFileSync(path.join(project, 'contract', 'demo.compact'), 'export circuit f(): [] {}\n');

  for (const k of ['XDG_DATA_HOME', 'COMPACT_INSTALL_DIR', 'MNKIT_NO_INSTALL']) delete process.env[k];
  Object.assign(process.env, {
    PATH: [dirs.bin, '/usr/bin', '/bin'].join(path.delimiter),
    HOME: dirs.home,
    XDG_BIN_HOME: dirs['xdg-bin'],
    FAKE_COMPACT_LOG: path.join(root, 'compact.log'),
    FAKE_COMPACT_STATE: dirs.state,
    FAKE_COMPACT_SRC: src,
  });
  const calls = () => {
    const log = process.env.FAKE_COMPACT_LOG;
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  };
  const compiled = () => fs.existsSync(path.join(project, 'contract', 'managed', 'demo', 'compiled'));
  return { project, dirs, calls, compiled, updates: () => calls().filter((c) => c.startsWith('update')) };
}

/** Serves `body` on localhost; resolves to { url, close }. */
async function serve(body) {
  const server = http.createServer((_, res) => res.end(body)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/compact-installer.sh`, close: () => server.close() };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('mnkit compile installs the pinned toolchain', () => {
  it('compiles with the pinned compiler when it is installed, installing nothing', async () => {
    const m = machine({ compiler: true });
    expect(await compile(m.project, { version: PIN })).toBe(0);
    expect(m.updates()).toEqual([]);
    expect(m.calls()).toContain(`compile +${PIN} contract/demo.compact contract/managed/demo`);
    expect(m.compiled()).toBe(true);
  });

  it('installs a missing compiler without changing the default, then compiles', async () => {
    const m = machine();
    expect(await compile(m.project, { version: PIN, skipZk: true })).toBe(0);
    expect(m.updates()).toEqual([`update ${PIN} --no-set-default`]);
    expect(m.calls()).toContain(`compile +${PIN} --skip-zk contract/demo.compact contract/managed/demo`);
    expect(m.compiled()).toBe(true);
  });

  it('makes the compiler the default when there is none', async () => {
    const m = machine({ default: null });
    expect(await compile(m.project, { version: PIN })).toBe(0);
    expect(m.updates()).toEqual([`update ${PIN}`]);
    expect(fs.readFileSync(path.join(m.dirs.state, 'default'), 'utf8').trim()).toBe(PIN);
    expect(m.compiled()).toBe(true);
  });

  it('fails instead of installing with install: false', async () => {
    const m = machine();
    await expect(compile(m.project, { version: PIN, install: false })).rejects.toThrow(
      `Run \`compact update ${PIN} --no-set-default\``,
    );
    expect(m.updates()).toEqual([]);
    expect(m.compiled()).toBe(false);
  });

  it('honours --no-install and MNKIT_NO_INSTALL on the command line', () => {
    const m = machine();
    for (const [args, env] of [
      [['--no-install'], {}],
      [[], { MNKIT_NO_INSTALL: '1' }],
    ]) {
      const r = spawnSync(process.execPath, [BIN, 'compile', ...args], {
        cwd: m.project,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/^✖ Compact compiler .* is not installed/);
    }
    expect(m.updates()).toEqual([]);
  });

  it('installs a missing Compact CLI from the verified installer, then the compiler', async () => {
    const m = machine({ cli: false });
    const server = await serve(FAKE_INSTALLER);
    try {
      const installer = { url: server.url, sha256: sha256(FAKE_INSTALLER) };
      expect(await compile(m.project, { version: PIN, installer })).toBe(0);
    } finally {
      server.close();
    }
    expect(fs.readFileSync(path.join(m.dirs.state, 'installer-args'), 'utf8').trim()).toBe('--quiet');
    // The install dir isn't on the shell's PATH yet, so mnkit put it on its own.
    expect(process.env.PATH.split(path.delimiter)[0]).toBe(m.dirs['xdg-bin']);
    // A fresh CLI has no default compiler, so the pin becomes it.
    expect(m.updates()).toEqual([`update ${PIN}`]);
    expect(m.compiled()).toBe(true);
  });

  it('refuses to run an installer whose sha256 does not match the pin', async () => {
    const m = machine({ cli: false });
    const server = await serve(FAKE_INSTALLER);
    const pinned = sha256('something else');
    try {
      await expect(compile(m.project, { version: PIN, installer: { url: server.url, sha256: pinned } })).rejects.toThrow(
        `has sha256 ${sha256(FAKE_INSTALLER)}, but mnkit pins ${pinned}. Not running it.`,
      );
    } finally {
      server.close();
    }
    expect(fs.existsSync(path.join(m.dirs.state, 'installer-args'))).toBe(false);
    expect(fs.existsSync(path.join(m.dirs['xdg-bin'], 'compact'))).toBe(false);
  });

  it('fails without the Compact CLI when installing is off', async () => {
    const m = machine({ cli: false });
    await expect(compile(m.project, { version: PIN, install: false })).rejects.toThrow(/`compact` CLI is not on PATH/);
    expect(m.calls()).toEqual([]);
  });

  it('leaves the default compiler alone when no version is pinned (the monorepo examples)', async () => {
    const m = machine();
    expect(await compile(m.project)).toBe(0);
    expect(m.calls()).toEqual(['compile contract/demo.compact contract/managed/demo']);
  });
});

describe('mnkit doctor', () => {
  it('warns, without failing, when the compiler is missing', async () => {
    machine();
    const check = (await runChecks()).find((c) => c.name === `Compact compiler ${PIN}`);
    expect(check).toMatchObject({ ok: true, warn: true });
    expect(check.detail).toContain('`npm run compile` installs it');
  });

  it('warns, without failing, when the Compact CLI is missing', async () => {
    machine({ cli: false });
    const check = (await runChecks()).find((c) => c.name === `Compact compiler ${PIN}`);
    expect(check).toMatchObject({ ok: true, warn: true });
    expect(check.detail).toMatch(/`compact` CLI is not installed: `npm run compile` installs Compact CLI/);
  });
});
