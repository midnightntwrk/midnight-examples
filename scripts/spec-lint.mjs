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

// Lint an example's SPEC.md (scripts/lib/spec-lint.mjs):
//
//   yarn spec:lint <name> [--design] [--json]
//   yarn spec:lint --file <path> [--witnesses | --no-witnesses] [--json]
//   yarn spec:lint --all [--json]
//
//   <name>          examples/<name>/SPEC.md: the design checks, then, once the
//                   contract is compiled, the code checks (the card against
//                   the contract and the sim tests)
//   --design        the design checks only
//   --file <path>   a design card that isn't in an example yet (step 1);
//                   --witnesses / --no-witnesses also checks the Witnesses
//                   section against that scaffold choice
//   --all           every example with a SPEC.md (CI)
//   --json          print { ok, results: [{ example, stage, problems }] }
//
// Exits 1 if any check fails.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCompiled } from './lib/contract-info.mjs';
import { lintCode, lintDesign } from './lib/spec-lint.mjs';
import { fail } from './lib/template.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
const USAGE =
  'Usage: yarn spec:lint <name> [--design] [--json] | --file <path> [--witnesses|--no-witnesses] [--json] | --all [--json]';

const args = process.argv.slice(2);
const opts = { json: false, design: false, all: false, file: null, witnessesFlag: undefined, name: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') opts.json = true;
  else if (a === '--design') opts.design = true;
  else if (a === '--all') opts.all = true;
  else if (a === '--witnesses') opts.witnessesFlag = true;
  else if (a === '--no-witnesses') opts.witnessesFlag = false;
  else if (a === '--file' && args[i + 1]) opts.file = path.resolve(args[++i]);
  else if (!a.startsWith('-') && !opts.name) opts.name = a;
  else fail(`unknown or incomplete argument: ${a}. ${USAGE}`);
}
if ([opts.name, opts.file, opts.all].filter(Boolean).length !== 1) fail(USAGE);

/** Lint one example: design, then code when compiled (unless --design). */
function lintExample(name) {
  const dir = path.join(EXAMPLES_DIR, name);
  const spec = path.join(dir, 'SPEC.md');
  if (!fs.existsSync(spec)) return [{ example: name, stage: 'design', problems: [`examples/${name}/SPEC.md not found`] }];
  const results = [{ example: name, stage: 'design', problems: lintDesign(fs.readFileSync(spec, 'utf8')) }];
  if (opts.design) return results;
  if (listCompiled(dir).length === 0) {
    results.push({ example: name, stage: 'code', skipped: 'not compiled: run yarn compile:fast', problems: [] });
  } else {
    results.push({ example: name, stage: 'code', problems: lintCode(dir) });
  }
  return results;
}

let results;
if (opts.file) {
  if (!fs.existsSync(opts.file)) fail(`${opts.file} not found`);
  const problems = lintDesign(fs.readFileSync(opts.file, 'utf8'), { witnessesFlag: opts.witnessesFlag });
  results = [{ example: path.relative(REPO_ROOT, opts.file), stage: 'design', problems }];
} else if (opts.all) {
  const names = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((n) => fs.existsSync(path.join(EXAMPLES_DIR, n, 'SPEC.md')))
    .sort();
  results = names.flatMap(lintExample);
} else {
  results = lintExample(opts.name);
}

const ok = results.every((r) => r.problems.length === 0);
if (opts.json) {
  console.log(JSON.stringify({ ok, results }, null, 2));
} else {
  for (const r of results) {
    if (r.skipped) console.log(`• ${r.example} (${r.stage}): skipped, ${r.skipped}`);
    else if (r.problems.length === 0) console.log(`✔ ${r.example} (${r.stage})`);
    else {
      console.log(`✖ ${r.example} (${r.stage}): ${r.problems.length} problem(s)`);
      for (const p of r.problems) console.log(`    - ${p}`);
    }
  }
}
process.exit(ok ? 0 : 1);
