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

// Phase 2 of scaffolding: adds a browser UI (examples/<name>/ui) to an example
// whose contract already compiles and whose tests pass (phase 1 is
// `npm run new:example`). Zero dependencies — Node built-ins only.
//
//   npm run new:ui -- <name> [--contract <managed-dir>] [--private-state memory|persistent]
//                                                   scaffold examples/<name>/ui
//   npm run new:ui -- <name> --dry-run [flags]            print what create would generate, write nothing
//   npm run new:ui -- <name> --check                      diff template-owned files (CI)
//   npm run new:ui -- <name> --sync                       rewrite template-owned files
//   npm run new:ui -- --check-all                         --check every generated UI, and the lockfile
//   npm run new:ui -- --sync-all                          --sync every generated UI, then npm install
//                                                   if a package.json changed
//
// The create-time choices (--contract, --private-state) are recorded in
// ui/new-ui.json, so --check and --sync re-render exactly what was created.
//
// The UI itself is rendered by the mnkit engine (packages/mnkit/src/lib/ui.mjs,
// which also serves `mnkit add ui`): what it reads from the compiled contract,
// the seed vs template-owned split and the `@if` blocks are described there.
// This script is the monorepo part: the gate, ui/new-ui.json, the
// ui/.template-files manifest, --check and --sync, and VERIFIED.md.
//
//   template-owned  identical for every example up to name substitution. Change
//                   them in packages/mnkit/templates/ui/, never in an example;
//                   --check fails when an example's copy diverges, --sync
//                   rewrites it.
//   seed            generated once, then owned by the example author. --check
//                   and --sync skip them.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_RE, assertNodeVersion, exitOnError, fail, writeFiles } from '../packages/mnkit/src/lib/template.mjs';
import { gatePath, readJson, sourceHash } from '../packages/mnkit/src/lib/gates.mjs';
import { SEED_FILES, UI_TEMPLATE_DIR, planUi, uiDetails, uiWarnings } from '../packages/mnkit/src/lib/ui.mjs';
import { readAll, renderBlock, skeleton, VERIFICATION_FILE, withBlock } from './lib/verification.mjs';

exitOnError();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
/** Every UI's hand-run verification status, one generated table (lib/verification.mjs). */
const VERIFIED_DOC = path.join(UI_TEMPLATE_DIR, 'VERIFIED.md');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
assertNodeVersion(REPO_ROOT);

function usage() {
  console.log(
    [
      'Usage: npm run new:ui -- <name> [--contract <managed-dir>] [--private-state memory|persistent]',
      '       npm run new:ui -- <name> --dry-run [--contract ...] [--private-state ...]',
      '       npm run new:ui -- <name> --check | --sync',
      '       npm run new:ui -- --check-all | --sync-all',
      '',
      '  <name>           existing example under examples/ (compile it first)',
      '  --contract       which contract/managed/<dir> to use when there are several',
      '  --private-state  where the browser keeps private state:',
      '                     memory      in memory, lost on reload',
      '                     persistent  encrypted IndexedDB, unlocked by a passphrase',
      '                   default: persistent when the create<X>PrivateState factory',
      '                   in contract/witnesses.ts takes arguments (per-user secrets),',
      '                   with or without witnesses; else memory',
      '  --skip-gate   create even though the in-memory gate has no stamp for the',
      '                current sources (.gates/sim.json, written by npm run pipeline)',
      '  --dry-run     print the create summary (forms, TODOs, storage, warnings) and',
      '                write nothing; works even when ui/ already exists',
      '  --check       compare template-owned files in examples/<name>/ui with the',
      '                template; exit 1 on any difference (seed files are ignored)',
      '  --sync        rewrite template-owned files in examples/<name>/ui (seeds untouched)',
      '  --check-all   --check every generated UI (examples/*/ui/new-ui.json), then',
      '                `npm ci --dry-run` to catch a stale package-lock.json',
      '  --sync-all    --sync every generated UI; runs `npm install` when a UI\'s',
      '                package.json changed (commit the package-lock.json it writes)',
    ].join('\n'),
  );
}

/**
 * Every generated UI, i.e. every examples/<name>/ui with a new-ui.json. A
 * hand-built UI (zk-loan) has none, so it's never touched.
 */
function generatedUis() {
  return fs
    .readdirSync(EXAMPLES_DIR)
    .filter((n) => fs.existsSync(path.join(EXAMPLES_DIR, n, 'ui', 'new-ui.json')))
    .sort();
}

/**
 * --check-all / --sync-all: run this script once per generated UI, as a child
 * process, so the single-UI flow below stays as it is. Returns the exit code.
 *
 * A template change is only done once *every* UI is synced, including one
 * created earlier in the same change, and package-lock.json matches the synced
 * package.json files. Both were easy to miss by hand.
 */
function runAll(each) {
  const names = generatedUis();
  if (names.length === 0) fail('no generated UIs found (examples/*/ui/new-ui.json)');
  const script = fileURLToPath(import.meta.url);
  const pkgJson = (n) => fs.readFileSync(path.join(EXAMPLES_DIR, n, 'ui', 'package.json'), 'utf8');
  const before = Object.fromEntries(names.map((n) => [n, pkgJson(n)]));
  const failed = names.filter(
    (n) => spawnSync(process.execPath, [script, n, `--${each}`], { stdio: 'inherit' }).status !== 0,
  );
  // No `shell:` option (opengrep flags any non-false value). Windows can only
  // run npm.cmd through cmd.exe, so call it explicitly; the args are literals.
  const npm = (args) => {
    const [cmd, argv] =
      process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'npm', ...args]] : ['npm', args];
    return spawnSync(cmd, argv, { cwd: REPO_ROOT, stdio: 'inherit' }).status === 0;
  };
  if (each === 'check') {
    console.log('\n  npm ci --dry-run (does package-lock.json match every package.json?)');
    const lockOk = npm(['ci', '--dry-run', '--ignore-scripts']);
    if (!lockOk) console.error('✖ package-lock.json is stale: run `npm install` and commit it.');
    if (failed.length) console.error(`✖ drifted: ${failed.join(', ')}`);
    return failed.length || !lockOk ? 1 : 0;
  }
  if (failed.length) {
    console.error(`✖ --sync failed for: ${failed.join(', ')}`);
    return 1;
  }
  const changed = names.filter((n) => pkgJson(n) !== before[n]);
  if (changed.length) {
    console.log(`\n  package.json changed in ${changed.join(', ')}: running npm install`);
    if (!npm(['install'])) return 1;
    console.log('  Commit the updated package-lock.json; CI installs with npm ci.');
  }
  console.log(`\n✔ Synced ${names.length} generated UI(s): ${names.join(', ')}. Review with \`git diff\`.`);
  return 0;
}

// --- arg parsing ------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  usage();
  process.exit(0);
}
const positionals = [];
const flags = new Set();
let contractFlag = null;
let privateStateFlag = null;
let skipGate = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--contract') contractFlag = argv[++i] ?? fail('--contract needs a value');
  else if (a.startsWith('--contract=')) contractFlag = a.slice('--contract='.length);
  else if (a === '--private-state') privateStateFlag = argv[++i] ?? fail('--private-state needs a value');
  else if (a.startsWith('--private-state=')) privateStateFlag = a.slice('--private-state='.length);
  else if (a === '--skip-gate') skipGate = true;
  else if (['--check', '--sync', '--check-all', '--sync-all', '--dry-run'].includes(a)) flags.add(a);
  else if (a.startsWith('-')) fail(`unknown flag ${a}`);
  else positionals.push(a);
}
if (flags.size > 1) fail('--check, --sync, --check-all, --sync-all and --dry-run are mutually exclusive');
if (flags.has('--check-all') || flags.has('--sync-all')) {
  if (positionals.length || contractFlag !== null || privateStateFlag !== null) {
    fail('--check-all / --sync-all take no <name>, --contract or --private-state (each UI keeps its new-ui.json)');
  }
  process.exit(runAll(flags.has('--check-all') ? 'check' : 'sync'));
}
if (positionals.length !== 1) {
  usage();
  fail('exactly one <name> argument is required');
}
const mode = flags.has('--check') ? 'check' : flags.has('--sync') ? 'sync' : 'create';
/** --dry-run: a create that stops before writing anything. */
const dryRun = flags.has('--dry-run');
const name = positionals[0];
if (!NAME_RE.test(name)) fail(`invalid name '${name}' (kebab-case, e.g. hello-world)`);
if (privateStateFlag !== null && !['memory', 'persistent'].includes(privateStateFlag)) {
  fail(`--private-state must be memory or persistent, not '${privateStateFlag}'`);
}

// --- phase-1 gate ------------------------------------------------------------
const exampleDir = path.join(EXAMPLES_DIR, name);
const uiDir = path.join(exampleDir, 'ui');
const pkg = `@midnight-ntwrk/example-${name}`;
if (!fs.existsSync(path.join(exampleDir, 'package.json'))) {
  fail(`examples/${name} does not exist. Scaffold it first:  npm run new:example ${name}`);
}
if (mode === 'create' && !dryRun && fs.existsSync(uiDir)) {
  fail(`examples/${name}/ui already exists. Use --check or --sync to compare/update template-owned files.`);
}
// The UI starts once the in-memory gate (typecheck, test:sim, the SPEC code
// checks) has passed on the current sources; the devnet runs in the background
// meanwhile (docs/generation-flow.md). Check, sync and dry runs don't need it.
if (mode === 'create' && !dryRun) {
  const stamp = readJson(gatePath(exampleDir, 'sim.json'));
  const fresh = stamp?.sourceHash === sourceHash(exampleDir);
  if (!fresh && !skipGate) {
    fail(
      `examples/${name} has not passed the in-memory gate on its current sources ` +
        `(${stamp ? 'the contract, witnesses or tests changed since it passed' : 'no .gates/sim.json'}). ` +
        `Run \`npm run pipeline ${name}\` (it creates the UI once the gate passes), or pass --skip-gate ` +
        '(an older example without a SPEC.md, after its own typecheck and test:sim).',
    );
  }
  if (!fresh) console.warn('⚠ --skip-gate: creating the UI without a passing in-memory gate on these sources.');
}
if (mode !== 'create' && !fs.existsSync(uiDir)) {
  fail(`examples/${name}/ui does not exist — nothing to ${mode}.`);
}

// Create-time choices, recorded so --check/--sync render the same thing. A UI
// created before new-ui.json existed has none; --sync writes it.
const CONFIG = 'new-ui.json';
const configPath = path.join(uiDir, CONFIG);
const savedConfig =
  mode !== 'create' && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
if (savedConfig && mode !== 'create') {
  for (const [flag, value, saved] of [
    ['--contract', contractFlag, savedConfig.contract],
    ['--private-state', privateStateFlag, savedConfig.privateState],
  ]) {
    if (value !== null && value !== saved) {
      fail(`${flag} ${value} conflicts with ui/${CONFIG} (${saved}). Edit ${CONFIG} to change it, then --sync.`);
    }
  }
  contractFlag = savedConfig.contract;
  privateStateFlag = savedConfig.privateState;
}

// --- render (packages/mnkit/src/lib/ui.mjs) ------------------------------------
const plan = planUi(exampleDir, {
  name,
  mode: 'monorepo',
  contract: contractFlag,
  privateState: privateStateFlag,
  networks: savedConfig?.networks ?? [],
  skipSeeds: mode !== 'create',
});
const { managed, configContent, files } = plan;

// --- manifest ----------------------------------------------------------------
// ui/.template-files lists the template-owned files as of the last create or
// sync. Without it, a file removed from packages/mnkit/templates/ui would
// linger in every generated UI and --check couldn't tell it from a file the
// author added.
const MANIFEST = '.template-files';
const posix = (p) => p.split(path.sep).join('/');
const templateOwned = files.filter((f) => !SEED_FILES.has(f.templateRel)).map((f) => posix(f.rel)).sort();
const manifestContent =
  '# Template-owned files, written by `npm run new:ui`. Do not edit; --sync rewrites it.\n' +
  templateOwned.map((f) => `${f}\n`).join('');
function readManifest() {
  const p = path.join(uiDir, MANIFEST);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}
/** Files the template used to own that still exist on disk. */
const stale = (readManifest() ?? []).filter(
  (f) => !templateOwned.includes(f) && fs.existsSync(path.join(uiDir, ...f.split('/'))),
);

// --- check / sync ------------------------------------------------------------
if (mode === 'check') {
  const drift = [];
  for (const f of files) {
    const onDisk = path.join(uiDir, f.rel);
    const actual = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : null;
    if (actual !== f.content) drift.push({ ...f, actual });
  }
  const manifestOnDisk = fs.existsSync(path.join(uiDir, MANIFEST))
    ? fs.readFileSync(path.join(uiDir, MANIFEST), 'utf8')
    : null;
  const problems = [];
  if (manifestOnDisk === null) problems.push(`  ${MANIFEST}  (missing)`);
  else if (manifestOnDisk !== manifestContent) problems.push(`  ${MANIFEST}  (out of date)`);
  if (savedConfig === null) problems.push(`  ${CONFIG}  (missing)`);
  else if (fs.readFileSync(configPath, 'utf8') !== configContent) problems.push(`  ${CONFIG}  (not canonical)`);
  for (const f of stale) problems.push(`  ${f}  (no longer in packages/mnkit/templates/ui)`);
  const verified = verifiedDoc();
  for (const e of verified.errors) problems.push(`  ${e}`);
  if (verified.stale) problems.push(`  packages/mnkit/templates/ui/VERIFIED.md  (its table is out of date with the verification.json files)`);
  if (drift.length === 0 && problems.length === 0) {
    console.log(`✔ examples/${name}/ui matches packages/mnkit/templates/ui (${files.length} template-owned files)`);
    process.exit(0);
  }
  console.error(`✖ examples/${name}/ui has drifted from packages/mnkit/templates/ui in ${drift.length + problems.length} file(s):\n`);
  for (const p of problems) console.error(p);
  for (const d of drift) {
    console.error(`  ${d.rel}${d.actual === null ? '  (missing)' : ''}  ← packages/mnkit/templates/ui/${d.templateRel}`);
    if (d.actual !== null) console.error(firstDifference(d.content, d.actual));
  }
  console.error(
    '\n  Template-owned files must stay identical across examples. Either move the change into\n' +
      `  packages/mnkit/templates/ui/ (then \`npm run new:ui -- ${name} --sync\` here and in any other UI), or, if it is\n` +
      '  example-specific, move it into a seed file (the api, panel, or circuits test).',
  );
  if (problems.length) {
    console.error(
      `  A missing/out-of-date ${MANIFEST} or ${CONFIG}, a stale file, or a stale VERIFIED.md table is fixed by\n` +
        `  \`npm run new:ui -- ${name} --sync\`. A malformed ${VERIFICATION_FILE} has to be fixed by hand.`,
    );
  }
  process.exit(1);
}

/**
 * packages/mnkit/templates/ui/VERIFIED.md as it should be, from every generated UI's
 * verification.json (this one included, even mid-create).
 */
function verifiedDoc() {
  const names = [...new Set([...generatedUis(), name])].sort();
  const { entries, errors } = readAll(EXAMPLES_DIR, names);
  const doc = fs.readFileSync(VERIFIED_DOC, 'utf8');
  const content = withBlock(doc, renderBlock(entries));
  if (content === null) return { errors: [...errors, 'packages/mnkit/templates/ui/VERIFIED.md: lost its BEGIN/END markers'], stale: false };
  return { errors, stale: content !== doc, content };
}

/** A few lines of context around the first differing line. */
function firstDifference(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  const lines = [`    first difference at line ${i + 1}:`];
  for (let j = Math.max(0, i - 1); j < Math.min(e.length, i + 3); j++) lines.push(`    - template: ${e[j]}`);
  for (let j = Math.max(0, i - 1); j < Math.min(a.length, i + 3); j++) lines.push(`    + on disk:  ${a[j]}`);
  return lines.join('\n');
}

const written = dryRun ? [] : writeFiles(uiDir, files).map((p) => path.relative(REPO_ROOT, p));
if (!dryRun) {
  fs.writeFileSync(path.join(uiDir, MANIFEST), manifestContent);
  fs.writeFileSync(configPath, configContent);
  // Author-owned once it exists: only ever created, never rewritten.
  const verificationPath = path.join(uiDir, VERIFICATION_FILE);
  if (!fs.existsSync(verificationPath)) fs.writeFileSync(verificationPath, skeleton());
  const verified = verifiedDoc();
  if (verified.errors.length) fail(`can't update packages/mnkit/templates/ui/VERIFIED.md:\n  ${verified.errors.join('\n  ')}`);
  if (verified.stale) fs.writeFileSync(VERIFIED_DOC, verified.content);
}

if (mode === 'sync') {
  for (const f of stale) fs.rmSync(path.join(uiDir, ...f.split('/')));
  console.log(`✔ Rewrote ${written.length} template-owned files in examples/${name}/ui (seed files untouched).`);
  if (stale.length) console.log(`  Removed ${stale.length} file(s) no longer in packages/mnkit/templates/ui: ${stale.join(', ')}`);
  console.log('  Review with `git diff`, then typecheck and test:unit.');
  process.exit(0);
}

// --- summary ----------------------------------------------------------------
const rel = (p) => p.split(path.sep).join('/');
console.log(
  dryRun
    ? `\n  Dry run: examples/${name}/ui from contract/managed/${managed} (nothing written)`
    : `\n✔ Scaffolded examples/${name}/ui from contract/managed/${managed}`,
);
console.log(uiDetails(plan));
if (!dryRun) {
  console.log(`\n  ${written.length} files created. Seed files (yours to edit):`);
  for (const f of files.filter((f) => SEED_FILES.has(f.templateRel))) {
    console.log(`    examples/${name}/ui/${rel(f.rel)}`);
  }
}
for (const line of uiWarnings(plan)) console.log(line);
if (dryRun) {
  console.log(`\n  Nothing written. Rerun without --dry-run to create examples/${name}/ui.\n`);
  process.exit(0);
}
console.log('\n  Next steps:');
console.log('    1. npm install   (the new workspace changes package-lock.json; commit it — CI uses npm ci)');
console.log(`    2. npm run typecheck -w ${pkg}-ui && npm run test:unit -w ${pkg}-ui && npm run build -w ${pkg}-ui`);
console.log('    3. Build the use case into the seed files above');
console.log(`    4. Work through the verification checklist in examples/${name}/ui/AGENTS.md`);
console.log('');
