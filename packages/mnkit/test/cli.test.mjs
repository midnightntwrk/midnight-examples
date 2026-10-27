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
import { renderExample } from '../src/lib/scaffold.mjs';
import { writeFiles } from '../src/lib/template.mjs';
import { FIXTURES, PKG_ROOT, TEMPLATE_DIR, cleanup, placeCompiled, scaffoldFixture, snapshot, tmpDir } from './helpers.mjs';

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
      expect(r.status).toBe(2);
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
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('✖ no compiled contract under contract/managed/');
  });

  describe('add contract', () => {
    /** A fresh private-tip-jar project with only its own contract written. */
    const project = () => {
      const dir = tmpDir();
      writeFiles(dir, renderExample(TEMPLATE_DIR, { name: 'private-tip-jar', witnesses: true }));
      fs.copyFileSync(
        path.join(FIXTURES, 'private-tip-jar', 'contract', 'private-tip-jar.compact'),
        path.join(dir, 'contract', 'private-tip-jar.compact'),
      );
      fs.writeFileSync(path.join(dir, 'mnkit.json'), JSON.stringify({ name: 'private-tip-jar' }));
      return dir;
    };

    it('writes a stub that compile and derive then wire in', () => {
      const dir = project();
      const r = mnkit(dir, 'add', 'contract', 'tip-token');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('✔ Created contract/tip-token.compact');
      const stub = fs.readFileSync(path.join(dir, 'contract', 'tip-token.compact'), 'utf8');
      expect(stub).toBe(fs.readFileSync(path.join(TEMPLATE_DIR, 'contract', '__name__.compact'), 'utf8'));

      // The author writes it and compiles: stand in the fixture's source and output.
      fs.copyFileSync(path.join(FIXTURES, 'private-tip-jar', 'contract', 'tip-token.compact'), path.join(dir, 'contract', 'tip-token.compact'));
      placeCompiled('private-tip-jar', dir);
      const d = mnkit(dir, 'derive');
      expect(d.status, d.stderr).toBe(0);
      expect(fs.readFileSync(path.join(dir, 'contract', 'index.ts'), 'utf8')).toContain('export const CompiledTipTokenContract');
      expect(fs.readFileSync(path.join(dir, 'src', 'test', 'private-tip-jar.test.ts'), 'utf8')).toContain("it('deploys tip-token'");
    });

    it('refuses bad names, the primary contract, an existing file and a non-project directory', () => {
      const dir = project();
      const cases = [
        [dir, ['add', 'contract', 'TipToken'], "invalid contract name 'TipToken'"],
        [dir, ['add', 'contract', 'private-tip-jar'], "is the project's own contract"],
        [dir, ['add', 'contract'], 'takes one name'],
        [dir, ['add', 'frob'], 'mnkit add takes one of: contract'],
        [tmpDir(), ['add', 'contract', 'tip-token'], 'run this from a project directory'],
      ];
      for (const [cwd, args, message] of cases) {
        const r = mnkit(cwd, ...args);
        expect(r.status, args.join(' ')).toBe(2);
        expect(r.stderr).toContain(message);
      }
      fs.writeFileSync(path.join(dir, 'contract', 'tip-token.compact'), '// mine\n');
      const r = mnkit(dir, 'add', 'contract', 'tip-token');
      expect(r.stderr).toContain('contract/tip-token.compact already exists');
      expect(fs.readFileSync(path.join(dir, 'contract', 'tip-token.compact'), 'utf8')).toBe('// mine\n');
    });
  });
});
