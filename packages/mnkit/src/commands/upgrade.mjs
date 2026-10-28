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
//                               you to merge (--force replaces the file). Until
//                               you delete <file>.mnkit-new the file stays
//                               unmerged (and --check fails); after that, your
//                               merge counts as your edit of the new version
//   you deleted it              left deleted; noted if the template changed it
//                               since (--force restores it)
//   gone from the template      deleted if unedited, else left and reported
//
// The UI's contract-derived files (ui/src/midnight/contract.ts and others the
// generator fills from the compiled contract) also change with the contract.
// mnkit.json records what else they render from (`sources`: the template file
// and the generator); while that is unchanged, a different render is your
// contract's doing: upgrade still applies it (as above), but --check doesn't
// count it as behind. Without a compiled contract they are skipped, with a
// note.
//
// The package.json files (the project's and ui/'s) are merged instead, three
// ways against what the last render had (mnkit.json's packageBase): the
// toolchain pins (pinFor), the runtime packages and mnkit are moved to this
// mnkit's wherever they are listed, a dependency or script you left as the
// template had it follows the template, new ones are added, overrides and
// engines follow the toolchain key by key, and your own changes stay (with a
// note where the template changed the same entry). A runtime package listed
// under an earlier name (RENAMED_PACKAGES) moves to its name now, and so do
// imports of it in files upgrade otherwise leaves alone. Other than that, seed
// files (the contracts, tests, README, SPEC and the UI's seeds) are never
// touched.
// Then mnkit.json records the new hashes and toolchain, and npm install runs.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  LATE_SEEDS,
  RENAMED_PACKAGES,
  RUNTIME_PACKAGES,
  fileHash,
  isTemplateOwned,
  packageBaseOf,
  projectToolchain,
  renderExample,
} from '../lib/scaffold.mjs';
import { NAME_RE, fail, toLf, withEolOf } from '../lib/template.mjs';
import { PKG_ROOT, loadToolchain, mnkitVersion, pinFor } from '../lib/toolchain.mjs';
import { listCompiled } from '../lib/contract-info.mjs';
import { UI_CONFIG, isUiOwned, planUi } from '../lib/ui.mjs';
import { packageSpecs } from './init.mjs';

const posix = (p) => p.split(path.sep).join('/');
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return fail(`${path.basename(p)}: ${err.message}`);
  }
};
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/**
 * `rel`, a POSIX path from mnkit.json, as a path under `dir`. Fails unless it
 * stays inside the project: mnkit.json is a file in the developer's tree, and
 * upgrade deletes and writes the paths it names.
 */
export function projectPath(dir, rel) {
  const segments = typeof rel === 'string' ? rel.split('/') : [];
  if (
    segments.length === 0 ||
    rel.includes('\\') ||
    path.isAbsolute(rel) ||
    path.win32.isAbsolute(rel) ||
    segments.some((s) => s === '' || s === '.' || s === '..')
  ) {
    fail(`mnkit.json: '${rel}' is not a path inside the project.`);
  }
  const at = path.join(dir, ...segments);
  // A symlink on the way (a directory, or the file itself) could still lead out.
  if (fs.lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`${rel} is a symlink; mnkit upgrade won't write through it.`);
  let parent = path.dirname(at);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const root = fs.realpathSync(dir);
  const real = fs.realpathSync(parent);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) fail(`mnkit.json: '${rel}' leads outside the project.`);
  return at;
}

/** The packages mnkit versions in lockstep with itself. */
const LOCKSTEP = [...RUNTIME_PACKAGES, 'mnkit'];
const DEP_FIELDS = ['dependencies', 'devDependencies'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * `cur` merged with `next` key by key, recursively: the template's keys win,
 * your extra keys stay, and a key the template dropped goes only if it is
 * still as `base` had it. (overrides and engines follow the toolchain.)
 */
function mergeObject(cur, next, base) {
  if (!isObject(cur) || !isObject(next)) return next;
  const out = { ...cur };
  for (const [k, v] of Object.entries(next)) out[k] = mergeObject(cur[k], v, isObject(base) ? base[k] : undefined);
  if (isObject(base)) for (const k of Object.keys(base)) if (!(k in next) && same(cur[k], base[k])) delete out[k];
  return out;
}

/**
 * `current` package.json text merged with the freshly rendered one, against
 * `base` (mnkit.json's packageBase for it: what the last render had; absent
 * for a project from an older mnkit). Returns { content, changes, notes }:
 * what changed, and what was left as is.
 *
 *   pinned (pinFor) and lockstep packages   moved to the template's version,
 *                                           wherever you list them, even ones
 *                                           the template doesn't
 *   other dependencies and scripts          the template's change is taken if
 *                                           yours is as the base had it; else
 *                                           yours stays, with a note
 *   overrides, engines                      merged key by key (mergeObject)
 */
export function mergePackageJson(current, rendered, tc, base) {
  const changes = [];
  const notes = [];
  const cur = renameDeps(JSON.parse(current), changes);
  base = base && renameDeps(structuredClone(base), []);
  const next = JSON.parse(rendered);
  const out = structuredClone(cur);
  const fieldOf = (pkg, o) => DEP_FIELDS.find((f) => o?.[f]?.[pkg] !== undefined);
  const baseSpec = (pkg) => base?.[fieldOf(pkg, base)]?.[pkg];
  for (const field of DEP_FIELDS) {
    for (const [pkg, spec] of Object.entries(next[field] ?? {})) {
      const where = fieldOf(pkg, cur);
      const was = baseSpec(pkg);
      if (where === undefined) {
        if (was === undefined) {
          out[field] = sortKeys({ ...out[field], [pkg]: spec });
          changes.push(`${field}: added ${pkg} ${spec}`);
        } else if (was !== spec) {
          notes.push(`${pkg}: you removed it, and the template now has ${spec}; left out`);
        }
        continue;
      }
      const have = cur[where][pkg];
      if (have === spec) continue;
      if (pinFor(tc, pkg) || LOCKSTEP.includes(pkg) || (was !== undefined && have === was)) {
        out[where][pkg] = spec;
        changes.push(`${where}: ${pkg} ${have} → ${spec}`);
      } else if (was !== spec) {
        notes.push(`${where}.${pkg} is ${have}; the template now has ${spec}: left as is`);
      }
    }
  }
  // Pinned packages you added yourself move with the others.
  for (const field of DEP_FIELDS) {
    for (const [pkg, have] of Object.entries(cur[field] ?? {})) {
      const pin = pinFor(tc, pkg);
      if (fieldOf(pkg, next) !== undefined || !pin || have === pin) continue;
      out[field][pkg] = pin;
      changes.push(`${field}: ${pkg} ${have} → ${pin}`);
    }
  }
  for (const [name, command] of Object.entries(next.scripts ?? {})) {
    const have = cur.scripts?.[name];
    const was = base?.scripts?.[name];
    if (have === command) continue;
    if (have === undefined) {
      if (was === undefined) {
        out.scripts = { ...out.scripts, [name]: command };
        changes.push(`scripts: added ${name}`);
      }
    } else if (was !== undefined && have === was) {
      out.scripts[name] = command;
      changes.push(`scripts: ${name} → ${command}`);
    } else if (was !== command) {
      notes.push(`scripts.${name} differs from the template's (${command}); left as is`);
    }
  }
  if (next.engines) {
    const engines = mergeObject(cur.engines ?? {}, next.engines, base?.engines);
    if (!same(engines, cur.engines)) {
      out.engines = engines;
      changes.push(`engines: ${JSON.stringify(cur.engines ?? {})} → ${JSON.stringify(engines)}`);
    }
  }
  for (const [pkg, spec] of Object.entries(next.overrides ?? {})) {
    const merged = mergeObject(cur.overrides?.[pkg], spec, base?.overrides?.[pkg]);
    if (same(cur.overrides?.[pkg], merged)) continue;
    out.overrides = { ...out.overrides, [pkg]: merged };
    changes.push(`overrides: ${pkg} → ${JSON.stringify(merged)}`);
  }
  for (const [pkg, spec] of Object.entries(base?.overrides ?? {})) {
    if (pkg in (next.overrides ?? {}) || !same(cur.overrides?.[pkg], spec)) continue;
    delete out.overrides[pkg];
    changes.push(`overrides: removed ${pkg}`);
  }
  return { content: changes.length ? withEolOf(`${JSON.stringify(out, null, 2)}\n`, current) : current, changes, notes };
}

/** `pkg` (a package.json object) with RENAMED_PACKAGES moved to their names now, each move pushed to `changes`. */
function renameDeps(pkg, changes) {
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || !Object.keys(deps).some((d) => d in RENAMED_PACKAGES)) continue;
    pkg[field] = sortKeys(Object.fromEntries(Object.entries(deps).map(([d, spec]) => [RENAMED_PACKAGES[d] ?? d, spec])));
    for (const d of Object.keys(deps)) if (d in RENAMED_PACKAGES) changes.push(`${field}: ${d} → ${RENAMED_PACKAGES[d]}`);
  }
  return pkg;
}

const OLD_NAME_RE = new RegExp(Object.keys(RENAMED_PACKAGES).map((n) => n.replace(/[/-]/g, '\\$&')).join('|'), 'g');
const CODE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'managed']);

/** POSIX paths of the code files under `dir` that import a runtime package by an earlier name. */
function filesWithOldNames(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name.startsWith('.') || SKIP_DIRS.has(e.name) ? [] : filesWithOldNames(dir, r);
    if (!e.isFile() || !CODE_RE.test(e.name)) return [];
    OLD_NAME_RE.lastIndex = 0;
    return OLD_NAME_RE.test(fs.readFileSync(path.join(dir, r), 'utf8')) ? [r] : [];
  });
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
 * unmerged | force | deleted | remove | orphan | seed | rename), `packages`
 * ([{ rel, content, changes, notes }]),
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
  if (typeof manifest.name !== 'string' || !NAME_RE.test(manifest.name)) fail(`mnkit.json: invalid project name '${manifest.name}'.`);
  const recorded = manifest.files ?? {};
  const conflicts = manifest.conflicts ?? {};
  for (const rel of [...Object.keys(recorded), ...Object.keys(conflicts)]) projectPath(dir, rel);
  // A conflict whose .mnkit-new is gone has been merged: from then on its base
  // is the version it was merged against.
  const bases = { ...recorded };
  const unmerged = new Set();
  for (const [rel, hash] of Object.entries(conflicts)) {
    if (fs.existsSync(`${projectPath(dir, rel)}.mnkit-new`)) unmerged.add(rel);
    else bases[rel] = hash;
  }

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
  /** Contract-derived files: POSIX path → templateSource. */
  const sources = {};
  /** Contract-derived files left as they are: no compiled contract to render them from. */
  const skipped = [];
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
      // contract/managed/ is git-ignored: a fresh clone or CI has none.
      withoutContract: !listCompiled(dir).includes(config.contract),
    });
    for (const f of ui.files.filter(isUiOwned)) {
      owned[`ui/${posix(f.rel)}`] = f.content;
      if (f.source) sources[`ui/${posix(f.rel)}`] = f.source;
    }
    for (const rel of ui.contractFiles ?? []) skipped.push(`ui/${posix(rel)}`);
    packages.push({ rel: 'ui/package.json', rendered: ui.files.find((f) => f.rel === 'package.json').content });
  }

  const files = [];
  /** The base mnkit.json records for each owned file; the new render's unless set here. */
  const nextBases = {};
  /** Conflicts still waiting for a merge: file → hash of its .mnkit-new. */
  const nextConflicts = {};
  for (const [rel, content] of Object.entries(owned)) {
    const onDisk = path.join(dir, ...rel.split('/'));
    const base = bases[rel];
    const ours = fileHash(content);
    // Only the contract can have changed it (see the header).
    const regen = rel in sources && manifest.sources?.[rel] === sources[rel];
    // What is written keeps the line endings the file has (a CRLF checkout stays CRLF).
    const disk = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : null;
    const push = (f) => {
      const g = disk === null ? f : { ...f, content: withEolOf(f.content, disk) };
      files.push(regen ? { ...g, regen } : g);
    };
    if (unmerged.has(rel) && !force) {
      push({ rel, kind: 'unmerged', content });
      nextBases[rel] = base;
      nextConflicts[rel] = ours;
      continue;
    }
    if (disk === null) {
      if (!(rel in bases)) files.push({ rel, kind: 'add', content });
      else if (force) files.push({ rel, kind: 'restore', content });
      else {
        // You deleted it: it stays deleted, against the base you deleted.
        if (base !== ours) files.push({ rel, kind: 'deleted' });
        nextBases[rel] = base;
      }
      continue;
    }
    if (toLf(disk) === content) continue;
    const theirs = fileHash(disk);
    if (base === theirs) push({ rel, kind: 'update', content });
    else if (base === ours) continue; // only you changed it
    else if (force) push({ rel, kind: 'force', content });
    else {
      push({ rel, kind: 'conflict', content });
      nextBases[rel] = base;
      nextConflicts[rel] = ours;
    }
  }
  // Skipped files keep their base, source and pending merge.
  for (const rel of skipped) {
    if (rel in recorded) nextBases[rel] = recorded[rel];
    if (manifest.sources?.[rel]) sources[rel] = manifest.sources[rel];
    if (rel in conflicts) nextConflicts[rel] = conflicts[rel];
  }
  for (const [rel, base] of Object.entries(recorded)) {
    if (rel in owned || skipped.includes(rel)) continue;
    const onDisk = projectPath(dir, rel);
    if (!fs.existsSync(onDisk)) continue;
    files.push({ rel, kind: fileHash(fs.readFileSync(onDisk, 'utf8')) === base ? 'remove' : 'orphan' });
  }
  // A seed file the project predates is written once; then it is the developer's.
  for (const rel of LATE_SEEDS) {
    const seed = rendered.find((f) => posix(f.rel) === rel);
    if (seed && !fs.existsSync(path.join(dir, ...rel.split('/')))) files.push({ rel, kind: 'seed', content: seed.content });
  }
  // Imports of a renamed runtime package, in files nothing above rewrites.
  const written = new Set(files.filter((f) => f.content !== undefined && f.kind !== 'conflict' && f.kind !== 'unmerged').map((f) => f.rel));
  for (const rel of filesWithOldNames(dir)) {
    if (written.has(rel)) continue;
    const disk = fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
    files.push({ rel, kind: 'rename', content: disk.replace(OLD_NAME_RE, (n) => RENAMED_PACKAGES[n]) });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const merged = packages.map(({ rel, rendered: next }) => ({
    rel,
    ...mergePackageJson(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'), next, tc, manifest.packageBase?.[rel]),
  }));

  const { conflicts: _, sources: __, ...rest } = manifest;
  const manifestOnDisk = fs.readFileSync(manifestPath, 'utf8');
  const nextManifest = {
    ...rest,
    mnkit: version,
    toolchain: projectToolchain(tc),
    files: sortKeys({
      ...Object.fromEntries(Object.entries(owned).map(([rel, content]) => [rel, nextBases[rel] ?? fileHash(content)])),
      ...Object.fromEntries(skipped.filter((rel) => rel in nextBases).map((rel) => [rel, nextBases[rel]])),
    }),
    ...(Object.keys(nextConflicts).length ? { conflicts: sortKeys(nextConflicts) } : {}),
    ...(Object.keys(sources).length ? { sources: sortKeys(sources) } : {}),
    packageBase: Object.fromEntries(packages.map(({ rel, rendered: next }) => [rel, packageBaseOf(next)])),
  };
  return {
    from: manifest.mnkit,
    to: version,
    files,
    skipped,
    packages: merged,
    toolchain: toolchainChanges(manifest.toolchain, projectToolchain(tc)),
    manifest: withEolOf(`${JSON.stringify(nextManifest, null, 2)}\n`, manifestOnDisk),
    manifestChanged: `${JSON.stringify(nextManifest, null, 2)}\n` !== toLf(manifestOnDisk),
  };
}

/** File kinds that are only reported: the project isn't behind because of them. */
const NOTES_ONLY = new Set(['deleted']);

/** Whether the project is behind this mnkit: changes beyond notes and the contract's own (mnkit.json aside). */
export const hasChanges = (plan) =>
  plan.files.some((f) => !NOTES_ONLY.has(f.kind) && !f.regen) || plan.packages.some((p) => p.changes.length > 0);

/** Writes the plan into `dir`. */
export function applyUpgrade(dir, plan) {
  const at = (rel) => projectPath(dir, rel);
  for (const f of plan.files) {
    if (f.kind === 'remove') fs.rmSync(at(f.rel));
    else if (f.kind === 'conflict' || f.kind === 'unmerged') fs.writeFileSync(`${at(f.rel)}.mnkit-new`, f.content);
    else if (f.content !== undefined) {
      fs.mkdirSync(path.dirname(at(f.rel)), { recursive: true });
      fs.writeFileSync(at(f.rel), f.content);
      if (f.kind === 'force') fs.rmSync(`${at(f.rel)}.mnkit-new`, { force: true });
    }
  }
  for (const p of plan.packages) if (p.changes.length) fs.writeFileSync(at(p.rel), p.content);
  if (plan.manifestChanged) fs.writeFileSync(at('mnkit.json'), plan.manifest);
}

const LABELS = {
  update: 'updated',
  add: 'added (new in the template)',
  seed: 'added (new in the template, and yours from now on: `npx mnkit derive` fills it)',
  restore: 'restored (--force; you had deleted it)',
  force: 'replaced (--force; it had your edits)',
  conflict: 'you edited it and so did the template: the new version is in',
  unmerged: 'not merged yet: merge it with',
  deleted: 'you deleted it, and the template has changed it since: left deleted (--force restores it)',
  remove: 'removed (no longer in the template)',
  orphan: 'no longer in the template, but you edited it: left in place',
  rename: 'imports of @midnight-ntwrk/mnkit-* renamed to @midnightntwrk/mnkit-*',
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
    console.log('\n  Files:');
    for (const f of plan.files) {
      const copy = f.kind === 'conflict' || f.kind === 'unmerged' ? ` ${f.rel}.mnkit-new` : '';
      console.log(`    ${f.rel}: ${f.regen ? '(your contract changed) ' : ''}${LABELS[f.kind]}${copy}`);
    }
  }
  if (plan.skipped.length) {
    console.log(`\n  ui/: ${plan.skipped.length} file(s) rendered from the compiled contract skipped. Compile it first (npm run compile).`);
  }
  for (const p of plan.packages.filter((p) => p.changes.length || p.notes.length)) {
    console.log(`\n  ${p.rel}:`);
    for (const c of p.changes) console.log(`    ${c}`);
    for (const n of p.notes) console.log(`    note: ${n}`);
  }
  const regen = plan.files.filter((f) => f.regen);
  if (!changed && !(regen.length && !check)) {
    console.log('\n✔ Up to date with this mnkit.');
    if (regen.length) console.log('  Your contract changed since the UI was rendered: `npx mnkit upgrade` refreshes the files above.');
    if (!check && plan.manifestChanged) applyUpgrade(dir, plan);
    return 0;
  }
  if (check) {
    const pending = plan.files.filter((f) => f.kind === 'unmerged' && !f.regen);
    if (pending.length < plan.files.filter((f) => !NOTES_ONLY.has(f.kind) && !f.regen).length || plan.packages.some((p) => p.changes.length)) {
      console.log('\n✖ The project is behind this mnkit. Run `npx mnkit upgrade`.');
    }
    if (pending.length) console.log('\n✖ Merge the .mnkit-new copies by hand, then delete them.');
    return 1;
  }
  applyUpgrade(dir, plan);
  const conflicts = plan.files.filter((f) => f.kind === 'conflict' || f.kind === 'unmerged');
  if (plan.packages.some((p) => p.changes.length) && !skipInstall) {
    console.log('\n▶ npm install');
    const r = spawnSync('npm', ['install'], { cwd: dir, stdio: 'inherit' });
    if (r.error) fail(`could not run npm: ${r.error.message}. Run \`npm install\` in the project yourself.`);
    if (r.status !== 0) fail('npm install failed. Fix the problem and run it again in the project.');
  }
  console.log(`\n✔ Upgraded to mnkit ${plan.to}.`);
  if (conflicts.length) {
    console.log(`  Merge ${conflicts.length} file(s) by hand, then delete the .mnkit-new copies:`);
    for (const f of conflicts) console.log(`    ${f.rel} ← ${f.rel}.mnkit-new`);
  }
  console.log('  Then: npm run typecheck && npm run test:sim (and npm run validate)');
  return 0;
}
