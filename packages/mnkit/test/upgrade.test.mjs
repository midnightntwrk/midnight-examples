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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addUi } from '../src/commands/add-ui.mjs';
import { packageSpecs } from '../src/commands/init.mjs';
import { applyUpgrade, hasChanges, mergePackageJson, planUpgrade, upgrade } from '../src/commands/upgrade.mjs';
import { fileHash, renderExample } from '../src/lib/scaffold.mjs';
import { writeFiles } from '../src/lib/template.mjs';
import { loadToolchain, mnkitVersion } from '../src/lib/toolchain.mjs';
import { FIXTURES, TEMPLATE_DIR, cleanup, placeCompiled, tmpDir } from './helpers.mjs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tc = loadToolchain();
const VERSION = mnkitVersion();
/** The toolchain of an older mnkit. */
const OLD_TC = (() => {
  const old = structuredClone(tc);
  old.npm['midnight-js'] = '4.1.0';
  old.npm.vitest = '5.0.0';
  old.images['midnightntwrk/proof-server'] = '8.1.0';
  delete old.overrides['vite-plugin-top-level-await/uuid'];
  return old;
})();
const OLD_IMAGE = "image: 'midnightntwrk/proof-server:8.1.0'";

const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const write = (dir, rel, content) => fs.writeFileSync(path.join(dir, ...rel.split('/')), content);
const manifestOf = (dir) => JSON.parse(read(dir, 'mnkit.json'));
const setManifest = (dir, edit) => write(dir, 'mnkit.json', `${JSON.stringify(edit(manifestOf(dir)), null, 2)}\n`);

/**
 * hello-world as an older mnkit (0.0.9, OLD_TC) scaffolded it. The template's
 * pins are literals that toolchain:check keeps in step with toolchain.json, so
 * that mnkit's compose.yml and package.json carried OLD_TC's versions: write
 * them back, with mnkit.json's hash of the old compose.yml.
 */
function olderProject() {
  const dir = tmpDir();
  writeFiles(
    dir,
    renderExample(TEMPLATE_DIR, { name: 'hello-world', mode: 'standalone', tc: OLD_TC, specs: packageSpecs('0.0.9'), mnkitVersion: '0.0.9' }),
  );
  const compose = read(dir, 'compose.yml').replace(/image: 'midnightntwrk\/proof-server:[^']+'/, OLD_IMAGE);
  write(dir, 'compose.yml', compose);
  setManifest(dir, (m) => ({ ...m, files: { ...m.files, 'compose.yml': fileHash(compose) } }));
  const pkg = JSON.parse(read(dir, 'package.json'));
  for (const p of Object.keys(pkg.dependencies)) {
    if (p.startsWith('@midnight-ntwrk/midnight-js-')) pkg.dependencies[p] = OLD_TC.npm['midnight-js'];
  }
  pkg.devDependencies.vitest = `^${OLD_TC.npm.vitest}`;
  write(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  return dir;
}

/** A project this mnkit just scaffolded. */
function currentProject() {
  const dir = tmpDir();
  writeFiles(
    dir,
    renderExample(TEMPLATE_DIR, { name: 'hello-world', mode: 'standalone', tc, specs: packageSpecs(VERSION), mnkitVersion: VERSION }),
  );
  return dir;
}

const kinds = (plan) => Object.fromEntries(plan.files.map((f) => [f.rel, f.kind]));

describe('mnkit upgrade', () => {
  it('finds nothing to do in a project this mnkit scaffolded', () => {
    const plan = planUpgrade(currentProject(), { tc, version: VERSION });
    expect(hasChanges(plan)).toBe(false);
    expect(plan.toolchain).toEqual([]);
  });

  it('updates unedited files, bumps the pins and keeps your edits and dependencies', () => {
    const dir = olderProject();
    const pkg = JSON.parse(read(dir, 'package.json'));
    pkg.dependencies['left-pad'] = '^1.3.0';
    pkg.scripts.test = 'vitest run --reporter=dot';
    write(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    write(dir, 'src/providers.ts', `${read(dir, 'src/providers.ts')}// mine\n`);
    const readme = read(dir, 'README.md');

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(plan.from).toBe('0.0.9');
    expect(plan.toolchain).toEqual(
      expect.arrayContaining(['npm.midnight-js: 4.1.0 → 4.1.1', `images.midnightntwrk/proof-server: 8.1.0 → ${tc.images['midnightntwrk/proof-server']}`]),
    );
    // AGENTS.md names the pins; compose.yml carries the images. Neither was edited.
    expect(kinds(plan)).toEqual({ 'AGENTS.md': 'update', 'compose.yml': 'update' });
    const [root] = plan.packages;
    expect(root.changes).toEqual(
      expect.arrayContaining([
        'dependencies: @midnight-ntwrk/midnight-js-contracts 4.1.0 → 4.1.1',
        `dependencies: @midnight-ntwrk/mnkit-wallet ^0.0.9 → ^${VERSION}`,
        `devDependencies: mnkit ^0.0.9 → ^${VERSION}`,
        'devDependencies: vitest ^5.0.0 → ^5.0.4',
        'overrides: vite-plugin-top-level-await → {"@swc/core":"1.15.47","uuid":"11.1.1"}',
      ]),
    );
    expect(root.notes).toEqual([expect.stringMatching(/^scripts\.test differs/)]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    expect(read(dir, 'compose.yml')).not.toContain(OLD_IMAGE);
    expect(read(dir, 'src/providers.ts')).toMatch(/\/\/ mine\n$/);
    expect(read(dir, 'README.md')).toBe(readme);
    const after = JSON.parse(read(dir, 'package.json'));
    expect(after.dependencies['left-pad']).toBe('^1.3.0');
    expect(after.scripts.test).toBe('vitest run --reporter=dot');
    expect(after.devDependencies.vitest).toBe('^5.0.4');
    expect(manifestOf(dir).mnkit).toBe(VERSION);
    expect(manifestOf(dir).toolchain.npm['midnight-js']).toBe('4.1.1');
    // Your providers.ts edit is not a conflict, now or next time.
    expect(hasChanges(planUpgrade(dir, { tc, version: VERSION }))).toBe(false);
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);
  });

  it('writes <file>.mnkit-new when both you and the template changed a file, once', () => {
    const dir = olderProject();
    write(dir, 'compose.yml', `${read(dir, 'compose.yml')}# my port mapping\n`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(1);

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)['compose.yml']).toBe('conflict');
    applyUpgrade(dir, plan);
    expect(read(dir, 'compose.yml')).toContain(OLD_IMAGE);
    expect(read(dir, 'compose.yml.mnkit-new')).not.toContain(OLD_IMAGE);
    // The base moved to the new template: no conflict on the next run.
    expect(kinds(planUpgrade(dir, { tc, version: VERSION }))['compose.yml']).toBeUndefined();
  });

  it('replaces an edited file with --force', () => {
    const dir = olderProject();
    write(dir, 'compose.yml', `${read(dir, 'compose.yml')}# my port mapping\n`);
    const plan = planUpgrade(dir, { tc, version: VERSION, force: true });
    expect(kinds(plan)['compose.yml']).toBe('force');
    applyUpgrade(dir, plan);
    expect(read(dir, 'compose.yml')).not.toContain('# my port mapping');
    expect(fs.existsSync(path.join(dir, 'compose.yml.mnkit-new'))).toBe(false);
  });

  it('deletes a file the template dropped unless you edited it, and restores a deleted one', () => {
    const dir = currentProject();
    write(dir, 'scripts/old.ts', '// from an older template\n');
    write(dir, 'scripts/older.ts', '// from an older template, edited\n');
    fs.rmSync(path.join(dir, 'vitest.config.ts'));
    setManifest(dir, (m) => ({
      ...m,
      files: { ...m.files, 'scripts/old.ts': fileHash('// from an older template\n'), 'scripts/older.ts': fileHash('// unedited\n') },
    }));
    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'scripts/old.ts': 'remove', 'scripts/older.ts': 'orphan', 'vitest.config.ts': 'restore' });
    applyUpgrade(dir, plan);
    expect(fs.existsSync(path.join(dir, 'scripts', 'old.ts'))).toBe(false);
    expect(read(dir, 'scripts/older.ts')).toContain('edited');
    expect(fs.existsSync(path.join(dir, 'vitest.config.ts'))).toBe(true);
    expect(manifestOf(dir).files['scripts/older.ts']).toBeUndefined();
  });

  it('adds the deploy files to a project that predates them, and seeds deploy-args.ts once', () => {
    const dir = currentProject();
    for (const rel of ['scripts/deploy.ts', 'src/deployments.ts', 'contract/deploy-args.ts']) fs.rmSync(path.join(dir, ...rel.split('/')));
    setManifest(dir, (m) => {
      const { 'scripts/deploy.ts': _, 'src/deployments.ts': __, ...files } = m.files;
      return { ...m, files };
    });
    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'contract/deploy-args.ts': 'seed', 'scripts/deploy.ts': 'add', 'src/deployments.ts': 'add' });
    applyUpgrade(dir, plan);
    expect(read(dir, 'contract/deploy-args.ts')).toContain("'hello-world': deployable<Contract>({");
    expect(manifestOf(dir).files['contract/deploy-args.ts']).toBeUndefined();

    write(dir, 'contract/deploy-args.ts', '// mine now\n');
    const again = planUpgrade(dir, { tc, version: VERSION });
    expect(hasChanges(again)).toBe(false);
  });

  it('upgrades the UI: restores its owned files and merges ui/package.json', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = currentProject();
    fs.cpSync(path.join(FIXTURES, 'hello-world', 'contract'), path.join(dir, 'contract'), { recursive: true });
    placeCompiled('hello-world', dir);
    fs.mkdirSync(path.join(dir, 'contract', 'managed', 'hello-world', 'keys'));
    addUi(dir, { name: 'hello-world', skipGate: true, skipInstall: true });
    expect(hasChanges(planUpgrade(dir, { tc, version: VERSION }))).toBe(false);

    const uiPkg = JSON.parse(read(dir, 'ui/package.json'));
    uiPkg.dependencies['@midnight-ntwrk/midnight-js-types'] = '4.1.0';
    uiPkg.dependencies['date-fns'] = '^4.0.0';
    write(dir, 'ui/package.json', `${JSON.stringify(uiPkg, null, 2)}\n`);
    fs.rmSync(path.join(dir, 'ui', 'src', 'lib', 'tokens.ts'));
    const panel = 'ui/src/components/hello-world-panel.tsx';
    write(dir, panel, '// my panel\n');

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'ui/src/lib/tokens.ts': 'restore' });
    expect(plan.packages[1]).toMatchObject({
      rel: 'ui/package.json',
      changes: ['dependencies: @midnight-ntwrk/midnight-js-types 4.1.0 → 4.1.1'],
    });
    applyUpgrade(dir, plan);
    expect(JSON.parse(read(dir, 'ui/package.json')).dependencies['date-fns']).toBe('^4.0.0');
    expect(read(dir, panel)).toBe('// my panel\n');
  });

  it('refuses outside a project', () => {
    expect(() => planUpgrade(tmpDir(), { tc })).toThrow(/one with a mnkit.json/);
  });

  it('refuses mnkit.json paths outside the project, and a bad name', () => {
    const dir = currentProject();
    const victim = path.join(path.dirname(dir), `victim-${path.basename(dir)}.txt`);
    fs.writeFileSync(victim, 'keep me\n');
    try {
      for (const rel of [`../${path.basename(victim)}`, victim, 'scripts/../../x', 'a\\b', '']) {
        setManifest(dir, (m) => ({ ...m, files: { ...m.files, [rel]: fileHash('keep me\n') } }));
        expect(() => planUpgrade(dir, { tc, version: VERSION })).toThrow(/mnkit\.json: '.*' (is not a path inside|leads outside) the project/);
        setManifest(dir, (m) => {
          const { [rel]: _, ...files } = m.files;
          return { ...m, files };
        });
      }
      // A symlinked directory leading out.
      fs.symlinkSync(path.dirname(dir), path.join(dir, 'out'));
      setManifest(dir, (m) => ({ ...m, files: { ...m.files, [`out/${path.basename(victim)}`]: fileHash('keep me\n') } }));
      expect(() => planUpgrade(dir, { tc, version: VERSION })).toThrow(/leads outside the project/);
      expect(fs.readFileSync(victim, 'utf8')).toBe('keep me\n');
    } finally {
      fs.rmSync(victim, { force: true });
    }
    const named = currentProject();
    setManifest(named, (m) => ({ ...m, name: '../x' }));
    expect(() => planUpgrade(named, { tc, version: VERSION })).toThrow(/invalid project name '\.\.\/x'/);
  });
});

describe('mergePackageJson', () => {
  it('leaves a package.json with nothing to change byte for byte', () => {
    const text = '{\n    "name": "x",\n    "dependencies": { "@midnight-ntwrk/midnight-js-types": "4.1.1" }\n}\n';
    const next = JSON.stringify({ name: 'x', dependencies: { '@midnight-ntwrk/midnight-js-types': '4.1.1' } });
    expect(mergePackageJson(text, next, tc)).toEqual({ content: text, changes: [], notes: [] });
  });

  it("keeps a dependency you moved off an unpinned template version", () => {
    const cur = JSON.stringify({ dependencies: { pino: '^10.0.0' } });
    const next = JSON.stringify({ dependencies: { pino: '^9.0.0' } });
    expect(mergePackageJson(cur, next, tc).changes).toEqual([]);
  });
});
