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

// Scaffolds a new example under examples/<name> from packages/mnkit/templates/example.
// Zero dependencies — Node built-ins only. Run with no AI assistance:
//
//   npm run new:example -- <name> [--witnesses] [--no-register]
//   npm run new:example -- <name> --derive
//
// After scaffolding, the author writes SPEC.md, then contract/<name>.compact,
// and fills in the test bodies. Everything else (harness, config, docker, docs
// stubs, and test skeletons up to the first deployContract call) is generated.
// Once the contract compiles (`npm run compile:fast`), --derive fills the
// @generated-stub regions from it: witness stubs, constructor arguments, an
// it.todo per circuit, the ledger fields, and for each other contract under
// contract/ (a test-only token) its exports, providers and a deploy test. See
// packages/mnkit/src/lib/derive.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDerive } from '../packages/mnkit/src/commands/derive.mjs';
import { preflight } from '../packages/mnkit/src/lib/preflight.mjs';
import { renderExample } from '../packages/mnkit/src/lib/scaffold.mjs';
import { lintDesign } from '../packages/mnkit/src/lib/spec-lint.mjs';
import { NAME_RE, exitOnError, fail, writeFiles } from '../packages/mnkit/src/lib/template.mjs';

exitOnError();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'packages', 'mnkit', 'templates', 'example');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');

function usage() {
  console.log(
    [
      'Usage: npm run new:example -- <name> [--witnesses] [--no-register] [--spec <file>]',
      '       npm run new:example -- <name> --derive',
      '',
      '  <name>          kebab-case example name (e.g. voting, hello-world)',
      '  --witnesses     generate a witnesses.ts stub and wire withWitnesses()',
      '  --no-register   do not edit ci.yaml / README.md / AGENTS.md',
      '  --spec <file>   the reviewed design card (step 1): lint it (npm run spec:lint',
      '                  --file), check --witnesses against its Witnesses section,',
      '                  and use it as the new example\'s SPEC.md',
      '  --derive        on an existing, compiled example: fill the @generated-stub',
      '                  regions (witness stubs, constructor args, it.todo per',
      '                  circuit) from the compiled contract. Safe to re-run.',
    ].join('\n'),
  );
}

// --- arg parsing ------------------------------------------------------------
const rawArgs = process.argv.slice(2);
// --spec takes a value; pull it out before the flag/positional split below.
const specIdx = rawArgs.indexOf('--spec');
const specFile = specIdx === -1 ? null : rawArgs[specIdx + 1];
if (specIdx !== -1 && (!specFile || specFile.startsWith('-'))) fail('--spec needs a file: --spec <path/to/SPEC.md>');
const args = specIdx === -1 ? rawArgs : rawArgs.filter((_, i) => i !== specIdx && i !== specIdx + 1);
if (args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(0);
}
// Reject unknown flags: a typo like `--witness` would otherwise scaffold a
// witness-free example that only fails later, at new:ui or at compile.
const KNOWN_FLAGS = new Set(['--witnesses', '--no-register', '--derive']);
const unknown = args.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
  usage();
  fail(`unknown option(s): ${unknown.join(' ')}`);
}
const withWitnesses = args.includes('--witnesses');
const noRegister = args.includes('--no-register');
const positionals = args.filter((a) => !a.startsWith('-'));
if (positionals.length !== 1) {
  usage();
  fail('exactly one <name> argument is required');
}
const name = positionals[0];
if (!NAME_RE.test(name)) {
  fail(`invalid name '${name}'. Use kebab-case: lowercase letters/digits, hyphen-separated (e.g. hello-world).`);
}

const targetDir = path.join(EXAMPLES_DIR, name);

// --- --derive: fill the stubs of an existing example, then stop ---------------
if (args.includes('--derive')) {
  if (withWitnesses || noRegister || specFile) fail('--derive runs on an existing example; it takes no other options.');
  if (!fs.existsSync(targetDir)) fail(`examples/${name} does not exist. Scaffold it first: npm run new:example ${name}`);
  runDerive(targetDir, name, {
    label: `examples/${name}`,
    next: `npm run typecheck && npm run test:sim   (in examples/${name})`,
  });
  process.exit(0);
}

// The next step is `compile`, so check the compiler now rather than after the
// contract is written. Docker is checked later, by `npm run validate`.
preflight(REPO_ROOT, { compact: true });

if (fs.existsSync(targetDir)) {
  fail(`examples/${name} already exists — choose a different name or remove it first.`);
}
if (!fs.existsSync(TEMPLATE_DIR)) {
  fail(`template directory not found at ${path.relative(REPO_ROOT, TEMPLATE_DIR)}`);
}

// --- the design card (step 1), checked before anything is written -------------
let specContent = null;
if (specFile) {
  if (!fs.existsSync(specFile)) fail(`--spec: ${specFile} not found`);
  specContent = fs.readFileSync(specFile, 'utf8');
  const problems = lintDesign(specContent, { witnessesFlag: withWitnesses });
  if (problems.length > 0) fail(`--spec ${specFile} fails the design lint:\n  - ${problems.join('\n  - ')}`);
}

// --- render + write ----------------------------------------------------------
const files = renderExample(TEMPLATE_DIR, { name, witnesses: withWitnesses, spec: specContent });
const created = writeFiles(targetDir, files).map((p) => path.relative(REPO_ROOT, p));

// --- registration (idempotent; a failure is fatal after the files are written) --
function registerCi() {
  const file = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yaml');
  const content = fs.readFileSync(file, 'utf8');
  const re = /example:\s*\[([^\]]*)\]/;
  const m = content.match(re);
  if (!m) return { ok: false, msg: 'ci.yaml: could not find the `example: [...]` matrix — add it manually.' };
  const items = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (items.includes(name)) return { ok: true, msg: 'ci.yaml: already listed' };
  items.push(name);
  fs.writeFileSync(file, content.replace(re, `example: [${items.join(', ')}]`));
  return { ok: true, msg: 'ci.yaml: added to CI matrix' };
}

function registerAgents() {
  const file = path.join(REPO_ROOT, 'AGENTS.md');
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(`| \`${name}\` |`)) return { ok: true, msg: 'AGENTS.md: already listed' };
  const lines = content.split('\n');
  const headerIdx = lines.findIndex((l) => /^\|\s*Example\s*\|/.test(l));
  if (headerIdx === -1) return { ok: false, msg: 'AGENTS.md: could not find the Examples table — add a row manually.' };
  let i = headerIdx + 2; // skip header + separator
  while (i < lines.length && lines[i].trimStart().startsWith('|')) i++;
  lines.splice(i, 0, `| \`${name}\` | TODO: what it teaches |`);
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true, msg: 'AGENTS.md: appended Examples table row' };
}

function registerReadme() {
  const file = path.join(REPO_ROOT, 'README.md');
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(`── ${name}/`)) return { ok: true, msg: 'README.md: already listed' };
  const lines = content.split('\n');
  const lastIdx = lines.findIndex((l) => /^│\s*└──\s+[a-z0-9-]+\/.*#/.test(l));
  if (lastIdx === -1) return { ok: false, msg: 'README.md: could not find the examples tree — add a line manually.' };
  lines.splice(lastIdx, 0, `│   ├── ${name}/   # TODO: one-line description`);
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true, msg: 'README.md: inserted into Layout tree' };
}

const registration = [];
if (!noRegister) {
  for (const fn of [registerCi, registerAgents, registerReadme]) {
    try {
      registration.push(fn());
    } catch (err) {
      registration.push({ ok: false, msg: `${fn.name}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

// --- summary ----------------------------------------------------------------
console.log(`\n✔ Scaffolded examples/${name} (${withWitnesses ? 'with witnesses' : 'witness-free'})\n`);
console.log(`  ${created.length} files created:`);
for (const f of created) console.log(`    ${f}`);
if (!noRegister) {
  console.log('\n  Registration:');
  for (const r of registration) console.log(`    ${r.ok ? '•' : '⚠'} ${r.msg}`);
} else {
  console.log('\n  Registration skipped (--no-register). Remember to add the example to:');
  console.log('    • .github/workflows/ci.yaml matrix');
  console.log('    • README.md Layout tree');
  console.log('    • AGENTS.md Examples table');
}
console.log('\n  Next steps (docs/generation-flow.md):');
console.log(
  specContent !== null
    ? `    1. SPEC.md is your reviewed design card (${specFile}); keep it in step with the code`
    : `    1. Fill in examples/${name}/SPEC.md and get the design reviewed (npm run spec:lint -- ${name} --design)`,
);
console.log('    2. npm install, then drive the rest from the repo root:');
console.log(`         npm run pipeline -- ${name} [--json]`);
console.log('       It runs the scripts and gates (compile:fast, --derive, typecheck, test:sim, the SPEC');
console.log('       checks, compile, the UI, the devnet in the background) and stops with what to do next:');
console.log(`       the contract (contract/${name}.compact), ${withWitnesses ? 'the witnesses, ' : ''}the sim test and the devnet test,`);
console.log('       then the UI seed files. Run it again after each change.');
console.log(`    By hand instead: npm run compile:fast, npm run new:example -- ${name} --derive, npm run typecheck,`);
console.log('       npm run test:sim, npm run spec:lint ' + name + ', then npm run validate (in examples/' + name + ').');
console.log('');

const failedRegistration = registration.filter((r) => !r.ok);
if (failedRegistration.length > 0) {
  fail(
    `examples/${name} was written, but registration failed (see ⚠ above). ` +
      'Fix the listed file(s) by hand, or re-run with --no-register after removing examples/' +
      name +
      '.',
  );
}
