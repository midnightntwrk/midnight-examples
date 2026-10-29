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

// Builds throwaway example dirs for the engine tests: the rendered template,
// a fixture's contract sources, and its committed compiler output laid out
// where the generators look for it (contract/managed/<c>/...).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderExample } from '../src/lib/scaffold.mjs';
import { writeFiles } from '../src/lib/template.mjs';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = path.join(PKG_ROOT, 'templates', 'example');
export const FIXTURES = path.join(PKG_ROOT, 'test', 'fixtures');

const tmpDirs = [];
export function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkit-test-'));
  tmpDirs.push(d);
  return d;
}
export function cleanup() {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** Lays a fixture's compiled output into dir/contract/managed/<c>/. */
export function placeCompiled(fixture, dir) {
  const compiled = path.join(FIXTURES, fixture, 'compiled');
  for (const c of fs.readdirSync(compiled)) {
    const managed = path.join(dir, 'contract', 'managed', c);
    fs.mkdirSync(path.join(managed, 'compiler'), { recursive: true });
    fs.mkdirSync(path.join(managed, 'contract'), { recursive: true });
    fs.copyFileSync(path.join(compiled, c, 'contract-info.json'), path.join(managed, 'compiler', 'contract-info.json'));
    fs.copyFileSync(path.join(compiled, c, 'index.d.ts'), path.join(managed, 'contract', 'index.d.ts'));
  }
}

/**
 * A scaffolded example named after the fixture, as an author has it after
 * writing the contract and running compile:fast: the template (with or
 * without the witnesses stub), the fixture's .compact files over the stub
 * contract, and the compiled output.
 */
export function scaffoldFixture(fixture, { witnesses = false } = {}) {
  const dir = tmpDir();
  writeFiles(dir, renderExample(TEMPLATE_DIR, { name: fixture, witnesses }));
  const src = path.join(FIXTURES, fixture, 'contract');
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.compact'))) {
    fs.copyFileSync(path.join(src, f), path.join(dir, 'contract', f));
  }
  placeCompiled(fixture, dir);
  return dir;
}

/** The fixture's own sources and compiled output, without the template. */
export function fixtureDir(fixture) {
  const dir = tmpDir();
  fs.cpSync(path.join(FIXTURES, fixture, 'contract'), path.join(dir, 'contract'), { recursive: true });
  placeCompiled(fixture, dir);
  return dir;
}

/** Every file under dir (relative path → content), for before/after comparisons. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** Rewrites every file under dir (but contract/managed) with CRLF line endings, as git's autocrlf checks them out. */
export function toCrlf(dir) {
  for (const [rel, content] of Object.entries(snapshot(dir))) {
    if (rel.startsWith(path.join('contract', 'managed'))) continue;
    fs.writeFileSync(path.join(dir, rel), content.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  }
}
