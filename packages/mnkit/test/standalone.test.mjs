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
import { packageSpecs } from '../src/commands/init.mjs';
import { KNOWN_TOKENS, RUNTIME_PACKAGES, fileHash, isTemplateOwned, renderExample, selectBlocks } from '../src/lib/scaffold.mjs';
import { loadToolchain } from '../src/lib/toolchain.mjs';
import { PKG_ROOT, TEMPLATE_DIR, cleanup, tmpDir } from './helpers.mjs';

afterEach(cleanup);

const tc = loadToolchain();
const specs = packageSpecs('0.1.0');
const standalone = (opts = {}) =>
  renderExample(TEMPLATE_DIR, { name: 'my-app', mode: 'standalone', tc, specs, mnkitVersion: '0.1.0', ...opts });
const byRel = (files) => Object.fromEntries(files.map((f) => [f.rel, f.content]));

describe('selectBlocks', () => {
  const src = ['a', '// @if monorepo', 'mono', '// @endif', '<!-- @if standalone -->', 'solo', '<!-- @endif -->', 'b'].join('\n');

  it('keeps the lines of the chosen mode and drops the markers', () => {
    expect(selectBlocks(src, 'monorepo')).toBe('a\nmono\nb');
    expect(selectBlocks(src, 'standalone')).toBe('a\nsolo\nb');
  });

  it.each([
    ['nested blocks', '# @if monorepo\n# @if standalone\n# @endif\n# @endif', /inside @if/],
    ['an unclosed block', '// @if monorepo\nx', /has no @endif/],
    ['a stray @endif', 'x\n// @endif', /without @if/],
    ['text on a marker line', '// @endif and more words', /alone on its line/],
  ])('rejects %s', (_, text, err) => {
    expect(() => selectBlocks(text, 'monorepo')).toThrow(err);
  });
});

describe('renderExample in standalone mode', () => {
  it('leaves no token, monorepo path, yarn command or workspace dependency', () => {
    for (const witnesses of [false, true]) {
      const files = standalone({ witnesses });
      for (const { rel, content } of files) {
        expect(KNOWN_TOKENS.filter((t) => content.includes(t)), rel).toEqual([]);
        expect(content, rel).not.toMatch(/\byarn\b|repo[- ]root|workspace:|\.\.\/\.\.\/(scripts|tsconfig|FAST-SYNC)/);
        expect(content, rel).not.toMatch(/@if (monorepo|standalone)|@endif/);
      }
    }
  });

  it('swaps in the standalone-only files', () => {
    const files = byRel(standalone());
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['.gitignore', 'tsconfig.json', 'mnkit.json']));
    expect(Object.keys(files).filter((r) => r === '.envrc' || r.startsWith('tutorials') || r.includes('standalone'))).toEqual([]);
    expect(JSON.parse(files['tsconfig.json']).extends).toBeUndefined();
    expect(files['.gitignore']).toContain('contract/managed/');
    expect(JSON.parse(files['mnkit.json'])).toMatchObject({ name: 'my-app', template: 'example', witnesses: false, mnkit: '0.1.0' });
  });

  it('records the toolchain and a hash of every template-owned file in mnkit.json', () => {
    const rendered = standalone();
    const files = byRel(rendered);
    const manifest = JSON.parse(files['mnkit.json']);
    expect(manifest.toolchain.images).toEqual(tc.images);
    expect(manifest.toolchain.$comment).toBeUndefined();
    const owned = Object.keys(files).filter(isTemplateOwned).sort();
    expect(Object.keys(manifest.files)).toEqual(owned);
    expect(owned).toEqual(expect.arrayContaining(['compose.yml', 'src/providers.ts', 'tsconfig.json', '.gitignore']));
    for (const seed of ['package.json', 'mnkit.json', 'README.md', 'contract/my-app.compact', 'src/test/my-app.test.ts']) {
      expect(owned, seed).not.toContain(seed);
    }
    for (const [rel, hash] of Object.entries(manifest.files)) expect(fileHash(files[rel]), rel).toBe(hash);
  });

  it('writes an npm package.json with mnkit scripts, pinned runtime packages and the overrides', () => {
    const pkg = JSON.parse(byRel(standalone())['package.json']);
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts).toMatchObject({
      compile: 'mnkit compile',
      'compile:fast': 'mnkit compile --skip-zk',
      derive: 'mnkit derive',
      validate: 'mnkit validate',
    });
    expect(pkg.scripts['test:local']).toBe(`MIDNIGHT_NETWORK=local ${pkg.scripts.test}`);
    for (const p of RUNTIME_PACKAGES) expect(pkg.dependencies[p]).toBe('^0.1.0');
    expect(pkg.devDependencies.mnkit).toBe('^0.1.0');
    expect(pkg.overrides).toEqual(tc.overrides);
    expect(pkg.engines.node).toBe(`>=${tc.node}.0.0`);
  });

  it('keeps the monorepo render on the repo layout', () => {
    const files = byRel(renderExample(TEMPLATE_DIR, { name: 'my-app', tc }));
    expect(files['.gitignore']).toBeUndefined();
    expect(files['mnkit.json']).toBeUndefined();
    expect(JSON.parse(files['tsconfig.json']).extends).toBe('../../tsconfig.base.json');
    expect(JSON.parse(files['package.json']).dependencies['@midnight-ntwrk/mnkit-sim']).toBe('workspace:^');
  });
});

describe('the standalone tsconfig', () => {
  it('matches the repo base options it inlines', () => {
    const repoBase = path.join(PKG_ROOT, '..', '..', 'tsconfig.base.json');
    const base = JSON.parse(fs.readFileSync(repoBase, 'utf8')).compilerOptions;
    const mono = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'tsconfig.json'), 'utf8'));
    const solo = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'tsconfig.standalone.json'), 'utf8'));
    expect(solo.compilerOptions).toEqual({ ...base, ...mono.compilerOptions });
    expect(solo.include).toEqual(mono.include);
  });
});

describe('packageSpecs', () => {
  it('points at local tarballs when asked, and says which one is missing', () => {
    const dir = tmpDir();
    for (const f of ['midnight-ntwrk-mnkit-coins-0.1.0.tgz', 'midnight-ntwrk-mnkit-sim-0.1.0.tgz', 'midnight-ntwrk-mnkit-wallet-0.1.0.tgz']) {
      fs.writeFileSync(path.join(dir, f), '');
    }
    expect(() => packageSpecs('0.1.0', dir)).toThrow(/mnkit-0\.1\.0\.tgz not found/);
    fs.writeFileSync(path.join(dir, 'mnkit-0.1.0.tgz'), '');
    expect(packageSpecs('0.1.0', dir)['@midnight-ntwrk/mnkit-sim']).toBe(`file:${path.join(dir, 'midnight-ntwrk-mnkit-sim-0.1.0.tgz')}`);
  });
});

describe('mnkit init', () => {
  const BIN = path.join(PKG_ROOT, 'bin', 'mnkit.mjs');
  const mnkit = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

  it('scaffolds a project, and refuses a non-empty directory', () => {
    const cwd = tmpDir();
    const r = mnkit(cwd, 'init', 'my-app', '--witnesses', '--skip-install');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('✔ Created my-app (with witnesses)');
    expect(fs.existsSync(path.join(cwd, 'my-app', 'contract', 'witnesses.ts'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(cwd, 'my-app', 'mnkit.json'), 'utf8')).witnesses).toBe(true);
    const again = mnkit(cwd, 'init', 'my-app', '--skip-install');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('already exists and is not an empty directory');
  });

  it('writes nothing on --dry-run and validates the name', () => {
    const cwd = tmpDir();
    const dry = mnkit(cwd, 'init', 'my-app', '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('package.json');
    expect(fs.existsSync(path.join(cwd, 'my-app'))).toBe(false);
    const bad = mnkit(cwd, 'init', 'My_App', '--dry-run');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("invalid project name 'My_App'");
    expect(mnkit(cwd, 'init', 'My_App', '--name', 'ok-name', '--dry-run').status).toBe(0);
  });
});
