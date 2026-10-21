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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PKG_ROOT, cleanup, scaffoldFixture, snapshot, tmpDir } from './helpers.mjs';

afterEach(cleanup);

const BIN = path.join(PKG_ROOT, 'bin', 'mnkit.mjs');
const mnkit = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

describe('mnkit CLI', () => {
  it('prints its version and usage', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    expect(mnkit(PKG_ROOT, '--version').stdout.trim()).toBe(pkg.version);
    const help = mnkit(PKG_ROOT, '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/^Usage: mnkit <command>/);
  });

  it('rejects unknown commands and options without a stack trace', () => {
    for (const args of [['frob'], ['derive', '--nope']]) {
      const r = mnkit(PKG_ROOT, ...args);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/^✖ /);
      expect(r.stderr).not.toMatch(/\bat .*\.mjs:\d+/);
    }
  });

  it('derives the project named in mnkit.json, idempotently', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    const renamed = path.join(tmpDir(), 'some-dir');
    fs.renameSync(dir, renamed);
    fs.writeFileSync(path.join(renamed, 'mnkit.json'), JSON.stringify({ name: 'private-tip-jar' }));
    const first = mnkit(renamed, 'derive');
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('✔ Derived private-tip-jar from contract/managed/private-tip-jar');
    const after = snapshot(renamed);
    expect(mnkit(renamed, 'derive').status).toBe(0);
    expect(snapshot(renamed)).toEqual(after);
  });

  it('fails derive before compile with a clear message', () => {
    const r = mnkit(tmpDir(), 'derive');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('✖ no compiled contract under contract/managed/');
  });
});
