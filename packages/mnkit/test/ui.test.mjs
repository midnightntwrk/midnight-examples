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
import { fileHash, renderExample } from '../src/lib/scaffold.mjs';
import { writeFiles } from '../src/lib/template.mjs';
import { UI_KNOWN_TOKENS, planUi } from '../src/lib/ui.mjs';
import { FIXTURES, TEMPLATE_DIR, cleanup, placeCompiled, tmpDir } from './helpers.mjs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The fixtures planUi can render, and the contract each UI is for. */
const FIXTURE_CONTRACTS = {
  'hello-world': null,
  'private-party': null,
  'silent-auction': null,
  'private-tip-jar': 'private-tip-jar',
};

/** A standalone project for `fixture`, as after `mnkit init`, writing the contract and `npm run compile`. */
function standaloneProject(fixture, { keys = true } = {}) {
  const dir = tmpDir();
  const witnesses = fs.existsSync(path.join(FIXTURES, fixture, 'contract', 'witnesses.ts'));
  writeFiles(
    dir,
    renderExample(TEMPLATE_DIR, { name: fixture, witnesses, mode: 'standalone', specs: packageSpecs('0.1.0'), mnkitVersion: '0.1.0' }),
  );
  fs.cpSync(path.join(FIXTURES, fixture, 'contract'), path.join(dir, 'contract'), { recursive: true });
  placeCompiled(fixture, dir);
  if (keys) {
    for (const c of fs.readdirSync(path.join(dir, 'contract', 'managed'))) {
      fs.mkdirSync(path.join(dir, 'contract', 'managed', c, 'keys'), { recursive: true });
    }
  }
  return dir;
}

const byRel = (files) => Object.fromEntries(files.map((f) => [f.rel.split(path.sep).join('/'), f.content]));
/** A tsconfig as tsc reads it: the template's JSON once the mode markers are gone. */
const tsconfig = (content) => JSON.parse(content);

describe('planUi in standalone mode', () => {
  it.each(Object.entries(FIXTURE_CONTRACTS))('renders %s with no token, repo path, yarn command or mode marker', (fixture, contract) => {
    const dir = standaloneProject(fixture);
    const { files } = planUi(dir, { name: fixture, mode: 'standalone', contract });
    for (const { rel, content } of files) {
      expect(UI_KNOWN_TOKENS.filter((t) => content.includes(t)), rel).toEqual([]);
      expect(content, rel).not.toMatch(/\byarn\b|repo[- ]root|workspace:|examples\/|templates\/ui|@midnight-ntwrk\/example-/);
      expect(content, rel).not.toMatch(/@if (monorepo|standalone)/);
    }
  });

  it('writes a plain npm package named <project>-ui, inlined tsconfigs and its own .gitignore', () => {
    const files = byRel(planUi(standaloneProject('hello-world'), { name: 'hello-world', mode: 'standalone' }).files);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('hello-world-ui');
    expect(pkg.scripts.dev).toBe('npm run copy:zk && vite');
    expect(pkg.scripts.build).toBe('npm run copy:zk && tsc -b && vite build');
    for (const t of ['tsconfig.app.json', 'tsconfig.node.json']) {
      expect(tsconfig(files[t]).extends, t).toBeUndefined();
      expect(tsconfig(files[t]).compilerOptions.strict, t).toBe(true);
    }
    expect(files['.gitignore']).toContain('public/managed/');
    expect(files['VERIFIED.md']).toBeUndefined();
    expect(files['scripts/copy-zk.mjs']).toContain('path.resolve(here, "../../package.json")');
    expect(files['src/components/deployment-card.tsx']).toContain('npm run fund:wallet {dustAddress}');
  });

  it('keeps the monorepo render on the repo layout', () => {
    const files = byRel(planUi(standaloneProject('hello-world'), { name: 'hello-world', mode: 'monorepo' }).files);
    expect(JSON.parse(files['package.json']).name).toBe('@midnight-ntwrk/example-hello-world-ui');
    expect(tsconfig(files['tsconfig.app.json']).extends).toBe('../../../tsconfig.base.json');
    expect(files['.gitignore']).toBeUndefined();
    expect(files['VERIFIED.md']).toBeUndefined();
    expect(files['src/components/deployment-card.tsx']).toContain('npm run fund:wallet {dustAddress}');
  });
});

describe('mnkit add ui', () => {
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});

  it('writes ui/, makes it a workspace and records the hashes of its template-owned files', () => {
    quiet();
    const dir = standaloneProject('private-tip-jar');
    const calls = [];
    const plan = addUi(dir, {
      name: 'private-tip-jar',
      contract: 'private-tip-jar',
      run: (cwd, args) => calls.push(args.join(' ')) > 0,
    });
    expect(calls).toEqual(['run typecheck', 'run test:sim', 'install']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).workspaces).toEqual(['ui']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'ui', 'new-ui.json'), 'utf8'))).toEqual({
      contract: 'private-tip-jar',
      privateState: plan.privateState,
    });
    const { files } = JSON.parse(fs.readFileSync(path.join(dir, 'mnkit.json'), 'utf8'));
    const owned = plan.files.filter((f) => !f.seed && f.rel !== 'package.json');
    expect(Object.keys(files).filter((f) => f.startsWith('ui/'))).toEqual(owned.map((f) => `ui/${f.rel}`).sort());
    for (const f of owned) expect(files[`ui/${f.rel}`]).toBe(fileHash(fs.readFileSync(path.join(dir, 'ui', f.rel), 'utf8')));
    expect(files['compose.yml']).toBeDefined();
    expect(files['ui/package.json']).toBeUndefined();
  });

  it('refuses without mnkit.json, an existing ui/, missing proving keys and a failing gate', () => {
    quiet();
    const pass = () => true;
    expect(() => addUi(tmpDir(), { name: 'x', run: pass })).toThrow(/one with a mnkit.json/);

    const noKeys = standaloneProject('hello-world', { keys: false });
    expect(() => addUi(noKeys, { name: 'hello-world', run: pass })).toThrow(/no proving keys.*npm run compile/);

    const dir = standaloneProject('hello-world');
    expect(() => addUi(dir, { name: 'hello-world', run: (cwd, args) => args[1] !== 'test:sim' })).toThrow(/in-memory gate failed/);
    expect(fs.existsSync(path.join(dir, 'ui'))).toBe(false);

    addUi(dir, { name: 'hello-world', skipInstall: true, run: pass });
    expect(() => addUi(dir, { name: 'hello-world', run: pass })).toThrow(/ui\/ already exists/);
  });

  it('writes nothing on a dry run', () => {
    quiet();
    const dir = standaloneProject('hello-world', { keys: false });
    const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    addUi(dir, { name: 'hello-world', dryRun: true, run: () => expect.unreachable('a dry run runs nothing') });
    expect(fs.existsSync(path.join(dir, 'ui'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(before);
  });
});
