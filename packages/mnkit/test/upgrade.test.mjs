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
    // Only you changed scripts.test: kept, with nothing to note.
    expect(root.notes).toEqual([]);

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

  it('writes <file>.mnkit-new when both you and the template changed a file, and remembers it until merged', () => {
    const dir = olderProject();
    write(dir, 'compose.yml', `${read(dir, 'compose.yml')}# my port mapping\n`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(1);

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)['compose.yml']).toBe('conflict');
    applyUpgrade(dir, plan);
    expect(read(dir, 'compose.yml')).toContain(OLD_IMAGE);
    const merged = read(dir, 'compose.yml.mnkit-new');
    expect(merged).not.toContain(OLD_IMAGE);

    // Still unmerged while the .mnkit-new is there: --check keeps failing.
    expect(kinds(planUpgrade(dir, { tc, version: VERSION }))).toEqual({ 'compose.yml': 'unmerged' });
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(1);
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    expect(read(dir, 'compose.yml.mnkit-new')).toBe(merged);

    // Merged and deleted: your merge is your edit of the new version.
    write(dir, 'compose.yml', `${merged}# my port mapping\n`);
    fs.rmSync(path.join(dir, 'compose.yml.mnkit-new'));
    const after = planUpgrade(dir, { tc, version: VERSION });
    expect(hasChanges(after)).toBe(false);
    applyUpgrade(dir, after);
    expect(manifestOf(dir).conflicts).toBeUndefined();
    expect(manifestOf(dir).files['compose.yml']).toBe(fileHash(merged));
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);
  });

  it('replaces an edited file with --force, and an unmerged one', () => {
    const dir = olderProject();
    write(dir, 'compose.yml', `${read(dir, 'compose.yml')}# my port mapping\n`);
    const plan = planUpgrade(dir, { tc, version: VERSION, force: true });
    expect(kinds(plan)['compose.yml']).toBe('force');
    applyUpgrade(dir, plan);
    expect(read(dir, 'compose.yml')).not.toContain('# my port mapping');
    expect(fs.existsSync(path.join(dir, 'compose.yml.mnkit-new'))).toBe(false);

    const pending = olderProject();
    write(pending, 'compose.yml', `${read(pending, 'compose.yml')}# my port mapping\n`);
    applyUpgrade(pending, planUpgrade(pending, { tc, version: VERSION }));
    const forced = planUpgrade(pending, { tc, version: VERSION, force: true });
    expect(kinds(forced)).toEqual({ 'compose.yml': 'force' });
    applyUpgrade(pending, forced);
    expect(fs.existsSync(path.join(pending, 'compose.yml.mnkit-new'))).toBe(false);
    expect(manifestOf(pending).conflicts).toBeUndefined();
    expect(hasChanges(planUpgrade(pending, { tc, version: VERSION }))).toBe(false);
  });

  it('deletes a file the template dropped unless you edited it', () => {
    const dir = currentProject();
    write(dir, 'scripts/old.ts', '// from an older template\n');
    write(dir, 'scripts/older.ts', '// from an older template, edited\n');
    setManifest(dir, (m) => ({
      ...m,
      files: { ...m.files, 'scripts/old.ts': fileHash('// from an older template\n'), 'scripts/older.ts': fileHash('// unedited\n') },
    }));
    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'scripts/old.ts': 'remove', 'scripts/older.ts': 'orphan' });
    applyUpgrade(dir, plan);
    expect(fs.existsSync(path.join(dir, 'scripts', 'old.ts'))).toBe(false);
    expect(read(dir, 'scripts/older.ts')).toContain('edited');
    expect(manifestOf(dir).files['scripts/older.ts']).toBeUndefined();
  });

  it('leaves a file you deleted deleted, notes a template change to it, and restores it with --force', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = currentProject();
    fs.rmSync(path.join(dir, 'AGENTS.md'));
    expect(kinds(planUpgrade(dir, { tc, version: VERSION }))).toEqual({});
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);

    // The template changed it since: a note, not "behind".
    setManifest(dir, (m) => ({ ...m, files: { ...m.files, 'AGENTS.md': fileHash('an older AGENTS.md\n') } }));
    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'AGENTS.md': 'deleted' });
    expect(hasChanges(plan)).toBe(false);
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
    expect(manifestOf(dir).files['AGENTS.md']).toBe(fileHash('an older AGENTS.md\n'));

    const forced = planUpgrade(dir, { tc, version: VERSION, force: true });
    expect(kinds(forced)).toEqual({ 'AGENTS.md': 'restore' });
    applyUpgrade(dir, forced);
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
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

  it('upgrades the UI: updates its owned files and merges ui/package.json', () => {
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
    write(dir, 'ui/src/lib/tokens.ts', '// an older tokens.ts\n');
    setManifest(dir, (m) => ({ ...m, files: { ...m.files, 'ui/src/lib/tokens.ts': fileHash('// an older tokens.ts\n') } }));
    const panel = 'ui/src/components/hello-world-panel.tsx';
    write(dir, panel, '// my panel\n');

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)).toEqual({ 'ui/src/lib/tokens.ts': 'update' });
    expect(plan.packages[1]).toMatchObject({
      rel: 'ui/package.json',
      changes: ['dependencies: @midnight-ntwrk/midnight-js-types 4.1.0 → 4.1.1'],
    });
    applyUpgrade(dir, plan);
    expect(JSON.parse(read(dir, 'ui/package.json')).dependencies['date-fns']).toBe('^4.0.0');
    expect(read(dir, panel)).toBe('// my panel\n');
  });

  /** hello-world with its UI, as `mnkit add ui` left it. */
  function uiProject() {
    const dir = currentProject();
    fs.cpSync(path.join(FIXTURES, 'hello-world', 'contract'), path.join(dir, 'contract'), { recursive: true });
    placeCompiled('hello-world', dir);
    fs.mkdirSync(path.join(dir, 'contract', 'managed', 'hello-world', 'keys'));
    addUi(dir, { name: 'hello-world', skipGate: true, skipInstall: true });
    return dir;
  }
  const INFO = 'contract/managed/hello-world/compiler/contract-info.json';
  /** A second circuit in the compiled contract, as if the developer added one and compiled. */
  function addCircuit(dir) {
    const info = JSON.parse(read(dir, INFO));
    info.circuits.push({ ...info.circuits[0], name: 'clearMessage', arguments: [] });
    write(dir, INFO, JSON.stringify(info));
  }

  it('upgrades the UI without a compiled contract, skipping the files rendered from it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = uiProject();
    const recorded = manifestOf(dir).files;
    fs.rmSync(path.join(dir, 'contract', 'managed'), { recursive: true });

    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(plan.files).toEqual([]);
    expect(plan.skipped).toContain('ui/src/midnight/contract.ts');
    expect(plan.skipped).not.toContain('ui/src/lib/tokens.ts');
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);
    // A template-owned file that doesn't read the contract is still upgraded.
    write(dir, 'ui/src/lib/tokens.ts', '// an older tokens.ts\n');
    setManifest(dir, (m) => ({ ...m, files: { ...m.files, 'ui/src/lib/tokens.ts': fileHash('// an older tokens.ts\n') } }));
    expect(kinds(planUpgrade(dir, { tc, version: VERSION }))).toEqual({ 'ui/src/lib/tokens.ts': 'update' });
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    // The skipped files keep their bases and sources.
    const after = manifestOf(dir);
    expect(after.files['ui/src/midnight/contract.ts']).toBe(recorded['ui/src/midnight/contract.ts']);
    expect(after.sources['ui/src/midnight/contract.ts']).toBeDefined();
  });

  it("re-renders the UI after a contract change without counting it as behind this mnkit", () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = uiProject();
    addCircuit(dir);
    const plan = planUpgrade(dir, { tc, version: VERSION });
    expect(kinds(plan)['ui/src/midnight/contract.ts']).toBe('update');
    expect(plan.files.every((f) => f.regen)).toBe(true);
    expect(hasChanges(plan)).toBe(false);
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    expect(read(dir, 'ui/src/midnight/contract.ts')).toContain('clearMessage');
    expect(planUpgrade(dir, { tc, version: VERSION }).files).toEqual([]);

    // Edited, then the contract changes again: a .mnkit-new, still not "behind".
    write(dir, 'ui/src/midnight/contract.ts', `${read(dir, 'ui/src/midnight/contract.ts')}// mine\n`);
    const info = JSON.parse(read(dir, INFO));
    info.circuits = info.circuits.filter((c) => c.name !== 'clearMessage');
    write(dir, INFO, JSON.stringify(info));
    expect(kinds(planUpgrade(dir, { tc, version: VERSION }))).toEqual({ 'ui/src/midnight/contract.ts': 'conflict' });
    expect(upgrade(dir, { tc, version: VERSION, skipInstall: true })).toBe(0);
    expect(read(dir, 'ui/src/midnight/contract.ts.mnkit-new')).not.toContain('clearMessage');
    expect(upgrade(dir, { tc, version: VERSION, check: true })).toBe(0);

    // A template change (a different source) is behind this mnkit as before.
    fs.rmSync(path.join(dir, 'ui/src/midnight/contract.ts.mnkit-new'));
    addCircuit(dir);
    setManifest(dir, (m) => ({ ...m, sources: { ...m.sources, 'ui/src/midnight/contract.ts': 'an older template' } }));
    const behind = planUpgrade(dir, { tc, version: VERSION });
    expect(behind.files.find((f) => f.rel === 'ui/src/midnight/contract.ts')).toMatchObject({ kind: 'conflict' });
    expect(hasChanges(behind)).toBe(true);
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
    expect(mergePackageJson(cur, next, tc, { dependencies: { pino: '^9.0.0' } })).toMatchObject({ changes: [], notes: [] });
  });

  const merge = (cur, next, base) => {
    const r = mergePackageJson(JSON.stringify(cur), JSON.stringify(next), tc, base);
    return { ...r, pkg: JSON.parse(r.content) };
  };

  it('takes a template change to an unpinned dependency you left alone, and notes one you changed', () => {
    const base = { devDependencies: { '@vitejs/plugin-react': '^5.0.0', vite: tc.npm.vite } };
    const next = { devDependencies: { '@vitejs/plugin-react': '^6.0.0', vite: tc.npm.vite } };
    const taken = merge(base, next, base);
    expect(taken.changes).toEqual(['devDependencies: @vitejs/plugin-react ^5.0.0 → ^6.0.0']);
    // No base (an older mnkit's project): not taken, but never silently.
    expect(merge(base, next, undefined)).toMatchObject({
      changes: [],
      notes: ['devDependencies.@vitejs/plugin-react is ^5.0.0; the template now has ^6.0.0: left as is'],
    });
    const mine = { devDependencies: { '@vitejs/plugin-react': '^5.1.0', vite: tc.npm.vite } };
    expect(merge(mine, next, base)).toMatchObject({ changes: [], notes: [expect.stringContaining('plugin-react is ^5.1.0')] });
  });

  it('bumps a pinned package you added, and one you moved to devDependencies, where it is', () => {
    const pin = tc.npm['midnight-js'];
    const cur = {
      dependencies: { '@midnight-ntwrk/midnight-js-fetch-zk-config-provider': '4.0.0' },
      devDependencies: { '@midnight-ntwrk/midnight-js-types': '4.0.0' },
    };
    const next = { dependencies: { '@midnight-ntwrk/midnight-js-types': pin } };
    const r = merge(cur, next, next);
    expect(r.pkg.dependencies).toEqual({ '@midnight-ntwrk/midnight-js-fetch-zk-config-provider': pin });
    expect(r.pkg.devDependencies).toEqual({ '@midnight-ntwrk/midnight-js-types': pin });
  });

  it('leaves out a dependency you removed', () => {
    const base = { dependencies: { pino: '^9.0.0' } };
    expect(merge({}, base, base)).toMatchObject({ changes: [], notes: [] });
    expect(merge({}, { dependencies: { pino: '^9.1.0' } }, base).notes).toEqual([expect.stringMatching(/^pino: you removed it/)]);
  });

  it('takes a template change to a script you left alone', () => {
    const r = merge({ scripts: { test: 'vitest run' } }, { scripts: { test: 'vitest run --silent' } }, { scripts: { test: 'vitest run' } });
    expect(r.pkg.scripts.test).toBe('vitest run --silent');
  });

  it('merges overrides and engines key by key, and removes an override the toolchain dropped', () => {
    const base = { overrides: { a: { b: '1.0.0' }, gone: '1.0.0', edited: '1.0.0' }, engines: { node: '>=22' } };
    const cur = { overrides: { a: { b: '1.0.0', mine: '2.0.0' }, gone: '1.0.0', edited: '1.5.0' }, engines: { node: '>=22', npm: '>=11' } };
    const next = { overrides: { a: { b: '1.1.0' } }, engines: { node: '>=22.12' } };
    const r = merge(cur, next, base);
    expect(r.pkg.overrides).toEqual({ a: { b: '1.1.0', mine: '2.0.0' }, edited: '1.5.0' });
    expect(r.pkg.engines).toEqual({ node: '>=22.12', npm: '>=11' });
    expect(r.changes).toEqual(expect.arrayContaining(['overrides: removed gone']));
  });
});
