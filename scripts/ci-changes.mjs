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

// Which CI jobs a change can affect (.github/workflows/ci.yaml, `changes` job).
// Prints one JSON object:
//   { "examples": ["hello-world", ...], "ui": true|false, "mnkit": true|false }
//
//   node scripts/ci-changes.mjs <base-ref>     files changed in <base-ref>...HEAD
//   node scripts/ci-changes.mjs --files a b c  these paths (to dry-run the rules)
//   node scripts/ci-changes.mjs --all          everything (push to main, manual runs)
//
// If git diff fails, everything runs. When an example starts using a file
// outside examples/<name>/, add that file to SHARED below.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Inputs of every example job: a change here runs all of them, plus ui and mnkit-e2e.
const SHARED = new Set([
  '.github/workflows/ci.yaml', // compiler and npm pins, the job steps
  '.npmrc',
  '.nvmrc',
  'package.json',
  'package-lock.json',
  'toolchain.json',
  'tsconfig.base.json',
  'scripts/ci-changes.mjs',
  'scripts/each-workspace.mjs', // postinstall
  // `Lint SPEC.md` step and its imports
  'scripts/spec-lint.mjs',
  'packages/mnkit/src/lib/spec-lint.mjs',
  'packages/mnkit/src/lib/contract-info.mjs',
  'packages/mnkit/src/lib/gates.mjs',
  'packages/mnkit/src/lib/template.mjs',
]);

const UI_PREFIXES = ['packages/mnkit/templates/ui/', 'packages/mnkit/src/lib/', 'scripts/lib/'];
const UI_FILES = new Set(['scripts/new-ui.mjs']);
const MNKIT_PREFIXES = ['packages/', 'scripts/lib/'];
const MNKIT_FILES = new Set(['scripts/mnkit-e2e.sh', 'scripts/pack-extras.mjs']);

const allExamples = () =>
  fs
    .readdirSync(path.join(ROOT, 'examples'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'examples', d.name, 'package.json')))
    .map((d) => d.name)
    .sort();

const hasUi = (name) => fs.existsSync(path.join(ROOT, 'examples', name, 'ui', 'new-ui.json'));

const everything = () => ({ examples: allExamples(), ui: true, mnkit: true });

export function plan(files) {
  if (files.some((f) => SHARED.has(f))) return everything();
  const examples = new Set();
  let ui = false;
  let mnkit = false;
  for (const f of files) {
    const m = /^examples\/([^/]+)\//.exec(f);
    if (m) {
      examples.add(m[1]);
      // A generated UI compiles and bundles its example's contract.
      if (hasUi(m[1])) ui = true;
    }
    if (UI_FILES.has(f) || UI_PREFIXES.some((p) => f.startsWith(p))) ui = true;
    if (MNKIT_FILES.has(f) || MNKIT_PREFIXES.some((p) => f.startsWith(p))) mnkit = true;
  }
  // Only names that are still examples (a PR may delete one).
  const known = new Set(allExamples());
  return { examples: [...examples].filter((e) => known.has(e)).sort(), ui, mnkit };
}

function changedFiles(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

const args = process.argv.slice(2);
let result;
if (args[0] === '--all') {
  result = everything();
} else if (args[0] === '--files') {
  result = plan(args.slice(1));
} else if (args.length === 1) {
  try {
    result = plan(changedFiles(args[0]));
  } catch (err) {
    console.error(`git diff against ${args[0]} failed (${err.message.trim()}); running everything.`);
    result = everything();
  }
} else {
  console.error('Usage: node scripts/ci-changes.mjs <base-ref> | --files <path>... | --all');
  process.exit(2);
}
console.log(JSON.stringify(result));
