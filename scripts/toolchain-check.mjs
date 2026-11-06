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
// compose.yml/compose.yaml image, the pinned deps and engines of every example,
// UI, template and package (any other @midnight-ntwrk or @midnightntwrk
// dependency is unpinned, and fails), the runtime packages' README overrides, and the pragma of every
// contract and engine test fixture. experimental/ is left out on purpose: it
// tracks release candidates. Interim, until mnkit moves to Ledger 9: the
// examples and their UIs are held to toolchain.json's `examples` section (the
// Ledger 9 stack), and mnkit's projects to the top-level pins (Ledger 8). It also fails when
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
const exampleProjects = dirsUnder('examples')
  .flatMap((d) => [d, path.join(d, 'ui')])
  .filter((d) => fs.existsSync(path.join(d, 'package.json')));
const projects = [
  ...dirsUnder('templates'),
  ...dirsUnder(path.join('packages', 'mnkit', 'templates')),
  ...exampleProjects,
  ...dirsUnder('packages'),
].filter((d) => fs.existsSync(path.join(d, 'package.json')));

// The examples' Ledger 9 pins (toolchain.json `examples`). Everything else
// (mnkit, its template and runtime packages) keeps the top-level pins.
const ex = tc.examples;
const isExample = (dir) => exampleProjects.includes(dir);
const compilerFor = (dir) => (isExample(dir) ? ex : tc).compact;
const imagesFor = (dir) => (isExample(dir) ? ex : tc).images;

/**
 * The version spec the examples pin `pkg` to, or null if they don't pin it.
 * Like pinFor, for the Ledger 9 stack: Midnight.js and testkit-js are still on
 * the @midnight-ntwrk scope, the wallet SDK and the ledger packages are on
 * @midnightntwrk.
 */
function examplePin(pkg, { peer = false } = {}) {
  const pin = (() => {
    if (pkg.startsWith('@midnight-ntwrk/midnight-js-')) return ex.npm['midnight-js'];
    if (pkg === '@midnight-ntwrk/testkit-js') return ex.npm['testkit-js'];
    if (pkg === '@midnightntwrk/wallet-sdk') return ex.npm['wallet-sdk'];
    if (pkg.startsWith('@midnightntwrk/wallet-sdk-')) return ex.npm[pkg.slice('@midnightntwrk/'.length)] ?? null;
    if (pkg === '@midnight-ntwrk/dapp-connector-api') return ex.npm['dapp-connector-api'];
    if (/^@midnight-?ntwrk\//.test(pkg) && typeof ex.overrides?.[pkg] === 'string') return ex.overrides[pkg];
    if (pkg === 'vite') return ex.npm.vite;
    if (pkg === 'vitest') return `^${ex.npm.vitest}`;
    return null;
  })();
  return pin && peer && !pin.startsWith('^') ? `~${pin}` : pin;
}

// --- README table -----------------------------------------------------------
{
  const f = path.join(REPO_ROOT, 'README.md');
  const src = read(f);
  const rows = [
    ['Compact language', /^\| Compact language \(`pragma`\) \| `([^`]+)` \|/m, ex.compact.language],
    ['Compact compiler', /^\| Compact compiler .*\| `([^`]+)` \|/m, ex.compact.compiler],
    ['midnight-js', /^\| `@midnight-ntwrk\/midnight-js-\*` \| `([^`]+)` \|/m, ex.npm['midnight-js']],
    ['testkit-js', /^\| `@midnight-ntwrk\/testkit-js` \| `([^`]+)` \|/m, ex.npm['testkit-js']],
    ['wallet SDK', /^\| wallet SDK \| `([^`]+)` \|/m, ex.npm['wallet-sdk']],
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
    // Any value form: bare, '…' or "…". Anything but a plain version is a mismatch.
    const hits = [...src.matchAll(/compact-version:\s*['"]?([^'"\s#]*)['"]?/g)];
    if (hits.length === 0 && name === 'ci.yaml') problems.push(`${rel(f)}: no compact-version found`);
    // ci.yaml's example and ui jobs build the examples (Ledger 9); every other
    // job and workflow builds mnkit (Ledger 8).
    for (const m of hits) {
      const job = [...src.slice(0, m.index).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].pop()?.[1];
      const want = name === 'ci.yaml' && ['example', 'ui'].includes(job) ? ex.compact.compiler : tc.compact.compiler;
      expect(`${rel(f)}:${lineOf(src, m.index)}`, 'compact-version', m[1], want);
    }
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
  // The examples' overrides (npm syntax) plus mnkit's, and nothing else.
  const want = { ...ex.overrides, ...npmOverrides(tc.overrides) };
  for (const pkg of new Set([...Object.keys(want), ...Object.keys(root.overrides ?? {})])) {
    expect('package.json', `overrides["${pkg}"]`, JSON.stringify(root.overrides?.[pkg]), JSON.stringify(want[pkg]));
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

// --- compose images ----------------------------------------------------------
// Both names docker compose reads. An image with no tag is a mismatch too.
for (const [dir, f] of projects.flatMap((d) => ['compose.yml', 'compose.yaml'].map((n) => [d, path.join(d, n)]))) {
  if (!fs.existsSync(f)) continue;
  const src = read(f);
  for (const m of src.matchAll(/image:\s*['"]?([^'"\s:]+(?::\d+\/[^'"\s:]+)?)(?::([^'"\s]+))?['"]?/g)) {
    const [, image, tag] = m;
    const want = imagesFor(dir)[image];
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
      const peer = field === 'peerDependencies';
      const want = isExample(dir) ? examplePin(pkg, { peer }) : pinFor(tc, pkg, { peer });
      if (want) expect(rel(f), `${field}["${pkg}"]`, spec, want);
      // Every other Midnight package but the lockstep runtime packages needs a pin.
      else if (/^@(midnight-ntwrk|midnightntwrk)\//.test(pkg) && !/^(@midnightntwrk\/mnkit-|@midnight-ntwrk\/example-)/.test(pkg)) {
        problems.push(`${rel(f)}: ${field}["${pkg}"] is not pinned in toolchain.json (add it to npm, and to pinFor)`);
      }
    }
  }
}

// --- pragmas -----------------------------------------------------------------
// Every .compact under a project's contract/, subfolders included, and the
// engine's compiled test fixtures.
const compactFiles = (d) =>
  fs.existsSync(d)
    ? fs
        .readdirSync(d, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.compact') && !e.parentPath.includes(`${path.sep}node_modules`))
        .map((e) => path.join(e.parentPath, e.name))
    : [];
for (const dir of [...projects, ...dirsUnder(path.join('packages', 'mnkit', 'test', 'fixtures'))]) {
  for (const f of compactFiles(path.join(dir, 'contract'))) {
    const src = read(f);
    const m = /pragma\s+language_version\s+([^;]+);/.exec(src);
    // A module-only file (zk-loan's schnorr.compact) may leave the pragma to its importer.
    if (m) expect(rel(f), 'pragma language_version', m[1].trim(), compilerFor(dir).language);
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
