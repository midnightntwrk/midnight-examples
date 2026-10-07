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

// Scaffolds a new example under examples/<name> from templates/example.
// Zero dependencies — Node built-ins only. Run with no AI assistance:
//
//   yarn new:example <name> [--witnesses] [--no-register]
//   yarn new:example <name> --derive
//
// After scaffolding, the author writes SPEC.md, then contract/<name>.compact,
// and fills in the test bodies. Everything else (harness, config, docker, docs
// stubs, and test skeletons up to the first deployContract call) is generated.
// Once the contract compiles (`yarn compile:fast`), --derive fills the
// @generated-stub regions from it: witness stubs, constructor arguments, an
// it.todo per circuit, the ledger fields. See scripts/lib/derive.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from './lib/derive.mjs';
import { preflight } from './lib/preflight.mjs';
import {
  NAME_RE,
  assertNoLeftoverTokens,
  deriveNames,
  fail,
  renderTree,
  substituteNames,
  writeFiles,
} from './lib/template.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'example');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');

function usage() {
  console.log(
    [
      'Usage: yarn new:example <name> [--witnesses] [--no-register]',
      '       yarn new:example <name> --derive',
      '',
      '  <name>          kebab-case example name (e.g. voting, hello-world)',
      '  --witnesses     generate a witnesses.ts stub and wire withWitnesses()',
      '  --no-register   do not edit ci.yaml / README.md / AGENTS.md',
      '  --derive        on an existing, compiled example: fill the @generated-stub',
      '                  regions (witness stubs, constructor args, it.todo per',
      '                  circuit) from the compiled contract. Safe to re-run.',
    ].join('\n'),
  );
}

// --- arg parsing ------------------------------------------------------------
const args = process.argv.slice(2);
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
  if (withWitnesses || noRegister) fail('--derive runs on an existing example; it takes no other options.');
  if (!fs.existsSync(targetDir)) fail(`examples/${name} does not exist. Scaffold it first: yarn new:example ${name}`);
  let result;
  try {
    result = derive(targetDir, name, deriveNames(name));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const list = (xs) => (xs.length ? xs.join(', ') : 'none');
  console.log(`\n✔ Derived examples/${name} from contract/managed/${result.managed}`);
  console.log(`    circuits: ${list(result.circuits)}${result.pureCircuits.length ? `; pure: ${list(result.pureCircuits)}` : ''}`);
  console.log(`    witnesses: ${list(result.witnesses)}`);
  console.log(`    constructor: ${list(result.ctorParams)}\n`);
  for (const r of result.report) {
    if (r.note) {
      console.log(`  ${r.rel}: ${r.note}`);
      continue;
    }
    const parts = Object.entries(r.status).map(([id, st]) => `${id} ${st}`);
    if (r.missing.length) parts.push(`no region for ${r.missing.join(', ')} (markers removed: yours now)`);
    console.log(`  ${r.rel}: ${parts.join('; ') || 'no regions'}`);
  }
  const edited = result.report.flatMap((r) => Object.entries(r.status ?? {}).filter(([, st]) => st === 'edited'));
  if (edited.length) {
    console.log('\n  "edited" regions were changed by hand and left alone. To regenerate one, restore its');
    console.log('  body to the generated text, or delete the body and set its sha= to e3b0c44298fc (empty).');
  }
  if (result.unstubbed.length) {
    console.log(`\n  ⚠ contract/witnesses.ts has no implementation for: ${result.unstubbed.join(', ')}`);
  }
  console.log('\n  Next: yarn typecheck && yarn test:sim   (in examples/' + name + ')\n');
  process.exit(0);
}

// The next step is `compile`, so check the compiler now rather than after the
// contract is written. Docker is checked later, by `yarn validate`.
preflight(REPO_ROOT, { compact: true });

if (fs.existsSync(targetDir)) {
  fail(`examples/${name} already exists — choose a different name or remove it first.`);
}
if (!fs.existsSync(TEMPLATE_DIR)) {
  fail(`template directory not found at ${path.relative(REPO_ROOT, TEMPLATE_DIR)}`);
}

// --- name derivations -------------------------------------------------------
const names = deriveNames(name);
const { Name } = names;

// --- token/marker substitution ----------------------------------------------
const KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__PRIVATE_STATE_IMPORT__',
  '__INITIAL_PRIVATE_STATE__',
  '__SIM_WITNESS_IMPORT__',
  '__SIM_WITNESSES__',
];

function substitute(content) {
  // 1) Plain name tokens (case-sensitive, non-overlapping).
  let out = substituteNames(content, names);

  // 2) Witness markers. Values are pre-resolved so ordering is irrelevant.
  if (withWitnesses) {
    out = out
      .replaceAll('__WITNESS_IMPORT__', "import { witnesses } from './witnesses.js';")
      .replaceAll('__WITNESS_METHOD__', 'withWitnesses(witnesses)')
      .replaceAll(
        '__PRIVATE_STATE_IMPORT__',
        `import { create${Name}PrivateState } from '../../contract/witnesses.js';`,
      )
      .replaceAll('__INITIAL_PRIVATE_STATE__', `create${Name}PrivateState()`)
      .replaceAll(
        '__SIM_WITNESS_IMPORT__',
        `import { create${Name}PrivateState, witnesses } from '../../contract/witnesses.js';`,
      )
      .replaceAll('__SIM_WITNESSES__', 'witnesses');
  } else {
    // Drop the whole marker line for the import markers.
    out = out
      .replaceAll('__WITNESS_IMPORT__\n', '')
      .replaceAll('__PRIVATE_STATE_IMPORT__\n', '')
      .replaceAll('__SIM_WITNESS_IMPORT__\n', '')
      .replaceAll('__SIM_WITNESSES__', '{}')
      .replaceAll('__WITNESS_METHOD__', 'withVacantWitnesses')
      .replaceAll('__INITIAL_PRIVATE_STATE__', '{}');
  }
  return out;
}

// --- render + write ----------------------------------------------------------
const files = renderTree(TEMPLATE_DIR, {
  name,
  // Only copy the witnesses stub when --witnesses is set.
  skip: (rel) => !withWitnesses && rel === path.join('contract', 'witnesses.ts'),
  render: (raw, rel) => {
    const content = substitute(raw);
    assertNoLeftoverTokens(rel, content, KNOWN_TOKENS);
    return content;
  },
});
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
console.log(`    1. Fill in examples/${name}/SPEC.md and get the design reviewed`);
console.log(`    2. Write your contract in examples/${name}/contract/${name}.compact, then:`);
console.log('         yarn install                          # from the repo root');
console.log(`         (cd examples/${name} && yarn compile:fast)   # seconds: no proving keys`);
console.log(`         yarn new:example ${name} --derive     # stubs from the compiled contract`);
console.log(`    3. ${withWitnesses ? 'Implement the witness stubs in contract/witnesses.ts; write ' : 'Write '}the tests:`);
console.log(`         src/test/${name}.sim.test.ts   in memory: logic, every guard, privacy invariants`);
console.log(`         src/test/${name}.test.ts       devnet: the end-to-end flow`);
console.log(`       cd examples/${name}`);
console.log('       yarn compile:fast && yarn typecheck && yarn test:sim   # until green');
console.log('    4. yarn validate                    # compile, env:up, wait:dust, test:local, env:down');
console.log(`    Optional, once validate passes: yarn new:ui ${name}   (browser frontend)`);
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
