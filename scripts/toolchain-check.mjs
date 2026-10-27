#!/usr/bin/env node
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

// `npm run toolchain:check`: fails when any copy of a pin disagrees with
// toolchain.json. The copies: the README table, every workflow's compact-version
// and npm, .nvmrc, the root package.json (engines, devEngines, overrides), every
// compose.yml image, the pinned deps and engines of every example, UI,
// template and package, the runtime packages' README overrides, and every
// contract's pragma. experimental/ is left out on purpose: it tracks release
// candidates. It also fails when
// package-lock.json nests a package inside a workspace (see below).
// Zero dependencies — Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmOverrides } from '../packages/mnkit/src/lib/scaffold.mjs';
import { pinFor } from '../packages/mnkit/src/lib/toolchain.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'toolchain.json'), 'utf8'));
const problems = [];
const rel = (f) => path.relative(REPO_ROOT, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const expect = (where, what, found, want) => {
  if (found !== want) problems.push(`${where}: ${what} is ${found ?? '(missing)'}, toolchain.json says ${want}`);
};
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// The oldest npm with min-release-age (.npmrc): the root package.json's
// devEngines asks for it. CI runs toolchain.json's npmCli.
const NPM_FLOOR = '11.10.0';

// Project dirs: the template, examples, their UIs and the shared packages.
const dirsUnder = (d) =>
  fs.existsSync(path.join(REPO_ROOT, d))
    ? fs
        .readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(REPO_ROOT, d, e.name))
    : [];
const projects = [
  ...dirsUnder('templates'),
  ...dirsUnder(path.join('packages', 'mnkit', 'templates')),
  ...dirsUnder('examples').flatMap((d) => [d, path.join(d, 'ui')]),
  ...dirsUnder('packages'),
].filter((d) => fs.existsSync(path.join(d, 'package.json')));

// --- README table -----------------------------------------------------------
{
  const f = path.join(REPO_ROOT, 'README.md');
  const src = read(f);
  const rows = [
    ['Compact language', /^\| Compact language \(`pragma`\) \| `([^`]+)` \|/m, tc.compact.language],
    ['Compact compiler', /^\| Compact compiler .*\| `([^`]+)` \|/m, tc.compact.compiler],
    ['midnight-js', /^\| `@midnight-ntwrk\/midnight-js-\*` \| `([^`]+)` \|/m, tc.npm['midnight-js']],
    ['testkit-js', /^\| `@midnight-ntwrk\/testkit-js` \| `([^`]+)` \|/m, tc.npm['testkit-js']],
    ['wallet SDK', /^\| wallet SDK \| `([^`]+)` \|/m, tc.npm['wallet-sdk']],
    ['Node.js', /^\| Node\.js \| `([^`]+)` /m, tc.node],
    ['npm', /^\| npm \| `([^`]+)` /m, tc.npmCli],
    ['Vitest', /^\| Vitest \| `([^`]+)` \|/m, tc.npm.vitest],
    ['Vite', /^\| Vite \| `([^`]+)` \|/m, tc.npm.vite],
  ];
  for (const [label, re, want] of rows) expect('README.md toolchain table', label, re.exec(src)?.[1], want);
}

// --- workflows: every compact-version (ci.yaml must have one) and npm --------
{
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  for (const name of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const f = path.join(dir, name);
    const src = read(f);
    const hits = [...src.matchAll(/compact-version:\s*'?([0-9][0-9.]*)'?/g)];
    if (hits.length === 0 && name === 'ci.yaml') problems.push(`${rel(f)}: no compact-version found`);
    for (const m of hits) expect(`${rel(f)}:${lineOf(src, m.index)}`, 'compact-version', m[1], tc.compact.compiler);
    for (const m of src.matchAll(/\bnpm@([0-9][^\s'"]*)/g)) expect(`${rel(f)}:${lineOf(src, m.index)}`, 'npm', m[1], tc.npmCli);
  }
}

// --- .nvmrc and the root package.json ----------------------------------------
expect('.nvmrc', 'Node', read(path.join(REPO_ROOT, '.nvmrc')).trim(), tc.node);
{
  const root = JSON.parse(read(path.join(REPO_ROOT, 'package.json')));
  expect('package.json', 'engines.node', root.engines?.node, `>=${tc.node}.0.0`);
  const pm = root.devEngines?.packageManager;
  expect('package.json', 'devEngines.packageManager', pm && `${pm.name}@${pm.version}`, `npm@>=${NPM_FLOOR}`);
  for (const [pkg, want] of Object.entries(npmOverrides(tc.overrides))) {
    expect('package.json', `overrides["${pkg}"]`, JSON.stringify(root.overrides?.[pkg]), JSON.stringify(want));
  }
}

// --- runtime package READMEs: "Install outside mnkit" ------------------------
// Each README gives the overrides (and the install line its peers) a project
// outside mnkit needs; they must be toolchain.json's.
for (const name of ['fast-sync', 'sim', 'coins']) {
  const f = path.join(REPO_ROOT, 'packages', name, 'README.md');
  const src = read(f);
  const m = /```json\n("overrides": \{[\s\S]*?\n\})\n```/.exec(src);
  if (!m) {
    problems.push(`${rel(f)}: no \`"overrides": { … }\` json block`);
    continue;
  }
  const where = `${rel(f)}:${lineOf(src, m.index)}`;
  let overrides;
  try {
    overrides = JSON.parse(`{${m[1]}}`).overrides;
  } catch (err) {
    problems.push(`${where}: overrides block is not valid JSON (${err.message})`);
    continue;
  }
  for (const [pkg, version] of Object.entries(overrides)) {
    if (!(pkg in tc.overrides)) problems.push(`${where}: overrides["${pkg}"] is not in toolchain.json overrides`);
    else expect(where, `overrides["${pkg}"]`, version, tc.overrides[pkg]);
  }
  for (const hit of src.matchAll(/(@midnight-ntwrk\/[a-z0-9-]+)@([0-9][^\s`]*)/g)) {
    const want = pinFor(tc, hit[1]);
    if (want) expect(`${rel(f)}:${lineOf(src, hit.index)}`, hit[1], hit[2], want);
  }
}

// --- package-lock.json: nothing nested under a UI ----------------------------
// npm never installs a package under a workspace that sits inside another
// workspace's folder (examples/<name>/ui), so a UI that needs a different
// version than the hoisted one silently gets the hoisted one
// (https://github.com/npm/cli/issues/4774). Align the version range instead.
{
  const lock = JSON.parse(read(path.join(REPO_ROOT, 'package-lock.json')));
  for (const key of Object.keys(lock.packages)) {
    if (/^examples\/[^/]+\/ui\/node_modules\//.test(key)) {
      problems.push(`package-lock.json: ${key} would never be installed (npm/cli#4774); align the UI's version range with the hoisted one`);
    }
  }
}

// --- compose.yml images ------------------------------------------------------
for (const dir of projects) {
  const f = path.join(dir, 'compose.yml');
  if (!fs.existsSync(f)) continue;
  const src = read(f);
  for (const m of src.matchAll(/image:\s*['"]?([^'"\s]+):([^'"\s]+)['"]?/g)) {
    const [, image, tag] = m;
    const want = tc.images[image];
    if (want) expect(`${rel(f)}:${lineOf(src, m.index)}`, image, tag, want);
    else problems.push(`${rel(f)}:${lineOf(src, m.index)}: image ${image} is not pinned in toolchain.json`);
  }
}

// --- package.json pins ---------------------------------------------------------
// The pins: pinFor (packages/mnkit/src/lib/toolchain.mjs), shared with `mnkit upgrade`.
for (const dir of projects) {
  const f = path.join(dir, 'package.json');
  const p = JSON.parse(read(f));
  expect(rel(f), 'engines.node', p.engines?.node, `>=${tc.node}.0.0`);
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [pkg, spec] of Object.entries(p[field] ?? {})) {
      const want = pinFor(tc, pkg, { peer: field === 'peerDependencies' });
      if (want) expect(rel(f), `${field}["${pkg}"]`, spec, want);
    }
  }
}

// --- pragmas -----------------------------------------------------------------
for (const dir of projects) {
  const contractDir = path.join(dir, 'contract');
  if (!fs.existsSync(contractDir)) continue;
  for (const name of fs.readdirSync(contractDir).filter((n) => n.endsWith('.compact'))) {
    const f = path.join(contractDir, name);
    const src = read(f);
    const m = /pragma\s+language_version\s+([^;]+);/.exec(src);
    // A module-only file (zk-loan's schnorr.compact) may leave the pragma to its importer.
    if (m) expect(rel(f), 'pragma language_version', m[1].trim(), tc.compact.language);
  }
}

{
  // Every public endpoint in a network config must be one of toolchain.json's
  // `networks`, so `mnkit doctor --network` probes what the code connects to.
  const known = new Set(Object.values(tc.networks).flatMap((n) => Object.values(n)).filter(Boolean));
  const configs = projects
    .map((d) => path.join(d, 'src', 'config.ts'))
    .filter((f) => fs.existsSync(f));
  for (const f of configs) {
    const src = read(f);
    for (const m of src.matchAll(/(?:https?|wss?):\/\/[^'"`\s]+/g)) {
      const url = m[0];
      if (!/^[a-z]+:\/\/[^/?]*(midnight\.network|blockfrost\.io)\b/.test(url)) continue;
      if (!known.has(url)) problems.push(`${rel(f)}:${lineOf(src, m.index)}: endpoint ${url} is not in toolchain.json networks`);
    }
  }
}

if (problems.length > 0) {
  console.error(`✖ toolchain:check found ${problems.length} disagreement(s) with toolchain.json:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ toolchain:check: ${projects.length} projects agree with toolchain.json`);
