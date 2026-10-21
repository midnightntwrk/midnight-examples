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

// `mnkit upgrade [--check] [--force]`: moves a standalone project to this
// mnkit's templates and toolchain. Run it after updating mnkit itself:
//
//   npm install --save-dev mnkit@latest && npx mnkit upgrade
//
// It re-renders the template-owned files (example template, and the UI's if
// ui/new-ui.json exists) with the choices recorded in mnkit.json and
// ui/new-ui.json, and compares each with the hash mnkit.json recorded when
// it was last rendered, the base:
//
//   only the template changed   the file is replaced
//   only you changed it         left alone
//   both changed                the new version goes to <file>.mnkit-new for
//                               you to merge (--force replaces the file)
//   gone from the template      deleted if unedited, else left and reported
//
// The package.json files (the project's and ui/'s) are merged instead: the
// toolchain pins (pinFor), the runtime packages and mnkit are moved to this
// mnkit's, new dependencies and scripts are added, overrides and engines
// follow the toolchain, and your own dependencies and scripts stay. Seed files
// (the contracts, tests, README, SPEC and the UI's seeds) are never touched.
// Then mnkit.json records the new hashes and toolchain, and npm install runs.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_PACKAGES, fileHash, isTemplateOwned, projectToolchain, renderExample } from '../lib/scaffold.mjs';
import { fail } from '../lib/template.mjs';
import { PKG_ROOT, loadToolchain, mnkitVersion, pinFor } from '../lib/toolchain.mjs';
import { UI_CONFIG, isUiOwned, planUi } from '../lib/ui.mjs';
import { packageSpecs } from './init.mjs';

const posix = (p) => p.split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/** The packages mnkit versions in lockstep with itself. */
const LOCKSTEP = [...RUNTIME_PACKAGES, 'mnkit'];

/**
 * `current` package.json text merged with the freshly rendered one. Returns
 * { content, changes, notes }: what changed, and what was left as is.
 */
export function mergePackageJson(current, rendered, tc) {
  const cur = JSON.parse(current);
  const next = JSON.parse(rendered);
  const out = structuredClone(cur);
  const changes = [];
  const notes = [];
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [pkg, spec] of Object.entries(next[field] ?? {})) {
      const have = cur[field]?.[pkg];
      if (have === spec) continue;
      if (have === undefined) {
        out[field] = sortKeys({ ...out[field], [pkg]: spec });
        changes.push(`${field}: added ${pkg} ${spec}`);
      } else if (pinFor(tc, pkg) || LOCKSTEP.includes(pkg)) {
        out[field][pkg] = spec;
        changes.push(`${field}: ${pkg} ${have} → ${spec}`);
      }
    }
  }
  for (const [name, command] of Object.entries(next.scripts ?? {})) {
    const have = cur.scripts?.[name];
    if (have === undefined) {
      out.scripts = { ...out.scripts, [name]: command };
      changes.push(`scripts: added ${name}`);
    } else if (have !== command) {
      notes.push(`scripts.${name} differs from the template's (${command}); left as is`);
    }
  }
  if (next.engines && JSON.stringify(cur.engines) !== JSON.stringify(next.engines)) {
    out.engines = next.engines;
    changes.push(`engines: ${JSON.stringify(cur.engines ?? {})} → ${JSON.stringify(next.engines)}`);
  }
  for (const [pkg, spec] of Object.entries(next.overrides ?? {})) {
    if (JSON.stringify(cur.overrides?.[pkg]) === JSON.stringify(spec)) continue;
    out.overrides = { ...out.overrides, [pkg]: spec };
    changes.push(`overrides: ${pkg} → ${JSON.stringify(spec)}`);
  }
  return { content: changes.length ? `${JSON.stringify(out, null, 2)}\n` : current, changes, notes };
}

/** "a.b: x → y" for every leaf of the toolchain that differs. */
function toolchainChanges(before = {}, after) {
  const flat = (o, prefix = '') =>
    Object.entries(o ?? {}).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
    );
  const old = Object.fromEntries(flat(before));
  return flat(after)
    .filter(([k, v]) => old[k] !== v)
    .map(([k, v]) => `${k}: ${old[k] ?? '(none)'} → ${v}`);
}

/**
 * What upgrading the project in `dir` would do, without doing it: `files`
 * ([{ rel, kind, content }] with kind update | add | restore | conflict |
 * force | remove | orphan), `packages` ([{ rel, content, changes, notes }]),
 * `toolchain` (changed pins) and the new mnkit.json content.
 */
export function planUpgrade(
  dir,
  { tc = loadToolchain(), version = mnkitVersion(), localDir = process.env.MNKIT_LOCAL_PACKAGES || null, force = false } = {},
) {
  const manifestPath = path.join(dir, 'mnkit.json');
  if (!fs.existsSync(manifestPath)) fail('run this from a project mnkit init created (one with a mnkit.json).');
  const manifest = readJson(manifestPath);
  if (manifest.template !== 'example') fail(`mnkit.json: unknown template '${manifest.template}'.`);
  const recorded = manifest.files ?? {};

  const rendered = renderExample(path.join(PKG_ROOT, 'templates', 'example'), {
    name: manifest.name,
    witnesses: manifest.witnesses,
    mode: 'standalone',
    tc,
    specs: packageSpecs(version, localDir),
    mnkitVersion: version,
  });
  /** Owned files as they render now: POSIX path → content. */
  const owned = Object.fromEntries(rendered.filter((f) => isTemplateOwned(f.rel)).map((f) => [posix(f.rel), f.content]));
  const packages = [{ rel: 'package.json', rendered: rendered.find((f) => f.rel === 'package.json').content }];

  const uiConfigPath = path.join(dir, 'ui', UI_CONFIG);
  if (fs.existsSync(uiConfigPath)) {
    const config = readJson(uiConfigPath);
    const ui = planUi(dir, {
      name: manifest.name,
      mode: 'standalone',
      contract: config.contract,
      privateState: config.privateState,
      networks: config.networks ?? [],
      skipSeeds: true,
    });
    for (const f of ui.files.filter(isUiOwned)) owned[`ui/${posix(f.rel)}`] = f.content;
    packages.push({ rel: 'ui/package.json', rendered: ui.files.find((f) => f.rel === 'package.json').content });
  }

  const files = [];
  for (const [rel, content] of Object.entries(owned)) {
    const onDisk = path.join(dir, ...rel.split('/'));
    if (!fs.existsSync(onDisk)) {
      files.push({ rel, kind: rel in recorded ? 'restore' : 'add', content });
      continue;
    }
    const disk = fs.readFileSync(onDisk, 'utf8');
    if (disk === content) continue;
    const base = recorded[rel];
    const theirs = fileHash(disk);
    const ours = fileHash(content);
    if (base === theirs) files.push({ rel, kind: 'update', content });
    else if (base === ours) continue; // only you changed it
    else files.push({ rel, kind: force ? 'force' : 'conflict', content });
  }
  for (const [rel, base] of Object.entries(recorded)) {
    if (rel in owned) continue;
    const onDisk = path.join(dir, ...rel.split('/'));
    if (!fs.existsSync(onDisk)) continue;
    files.push({ rel, kind: fileHash(fs.readFileSync(onDisk, 'utf8')) === base ? 'remove' : 'orphan' });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const merged = packages.map(({ rel, rendered: next }) => ({
    rel,
    ...mergePackageJson(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'), next, tc),
  }));

  const nextManifest = {
    ...manifest,
    mnkit: version,
    toolchain: projectToolchain(tc),
    files: sortKeys(Object.fromEntries(Object.entries(owned).map(([rel, content]) => [rel, fileHash(content)]))),
  };
  return {
    from: manifest.mnkit,
    to: version,
    files,
    packages: merged,
    toolchain: toolchainChanges(manifest.toolchain, projectToolchain(tc)),
    manifest: `${JSON.stringify(nextManifest, null, 2)}\n`,
    manifestChanged: `${JSON.stringify(nextManifest, null, 2)}\n` !== fs.readFileSync(manifestPath, 'utf8'),
  };
}

/** Whether the plan changes anything a developer would notice (mnkit.json aside). */
export const hasChanges = (plan) => plan.files.length > 0 || plan.packages.some((p) => p.changes.length > 0);

/** Writes the plan into `dir`. */
export function applyUpgrade(dir, plan) {
  const at = (rel) => path.join(dir, ...rel.split('/'));
  for (const f of plan.files) {
    if (f.kind === 'remove') fs.rmSync(at(f.rel));
    else if (f.kind === 'conflict') fs.writeFileSync(`${at(f.rel)}.mnkit-new`, f.content);
    else if (f.kind !== 'orphan') {
      fs.mkdirSync(path.dirname(at(f.rel)), { recursive: true });
      fs.writeFileSync(at(f.rel), f.content);
    }
  }
  for (const p of plan.packages) if (p.changes.length) fs.writeFileSync(at(p.rel), p.content);
  if (plan.manifestChanged) fs.writeFileSync(at('mnkit.json'), plan.manifest);
}

const LABELS = {
  update: 'updated',
  add: 'added (new in the template)',
  restore: 'restored (it was deleted)',
  force: 'replaced (--force; it had your edits)',
  conflict: 'you edited it and so did the template: the new version is in',
  remove: 'removed (no longer in the template)',
  orphan: 'no longer in the template, but you edited it: left in place',
};

/** `mnkit upgrade`: returns the exit code. */
export function upgrade(dir, { check = false, force = false, skipInstall = false, ...opts } = {}) {
  const plan = planUpgrade(dir, { ...opts, force });
  const changed = hasChanges(plan);
  console.log(`mnkit upgrade: ${plan.from ?? '(unknown)'} → ${plan.to}${check ? ' (--check: nothing written)' : ''}`);
  if (plan.toolchain.length) {
    console.log('\n  Toolchain:');
    for (const t of plan.toolchain) console.log(`    ${t}`);
  }
  if (plan.files.length) {
    console.log('\n  Template-owned files:');
    for (const f of plan.files) {
      console.log(`    ${f.rel}: ${LABELS[f.kind]}${f.kind === 'conflict' ? ` ${f.rel}.mnkit-new` : ''}`);
    }
  }
  for (const p of plan.packages.filter((p) => p.changes.length || p.notes.length)) {
    console.log(`\n  ${p.rel}:`);
    for (const c of p.changes) console.log(`    ${c}`);
    for (const n of p.notes) console.log(`    note: ${n}`);
  }
  if (!changed) {
    console.log('\n✔ Up to date: nothing to change.');
    if (!check && plan.manifestChanged) applyUpgrade(dir, plan);
    return 0;
  }
  if (check) {
    console.log('\n✖ The project is behind this mnkit. Run `npx mnkit upgrade`.');
    return 1;
  }
  applyUpgrade(dir, plan);
  const conflicts = plan.files.filter((f) => f.kind === 'conflict');
  if (plan.packages.some((p) => p.changes.length) && !skipInstall) {
    console.log('\n▶ npm install');
    if (spawnSync('npm', ['install'], { cwd: dir, stdio: 'inherit' }).status !== 0) {
      fail('npm install failed. Fix the problem and run it again in the project.');
    }
  }
  console.log(`\n✔ Upgraded to mnkit ${plan.to}.`);
  if (conflicts.length) {
    console.log(`  Merge ${conflicts.length} file(s) by hand, then delete the .mnkit-new copies:`);
    for (const f of conflicts) console.log(`    ${f.rel} ← ${f.rel}.mnkit-new`);
  }
  console.log('  Then: npm run typecheck && npm run test:sim (and npm run validate)');
  return 0;
}
