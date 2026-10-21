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

// `mnkit add ui`: a browser UI in ui/ for the project's compiled contract
// (lib/ui.mjs renders it). The project's root package.json gets ui as an npm
// workspace, so one `npm install` at the root installs both and hoists the
// shared midnight-js packages.
//
// The UI starts once the contract compiles with its proving keys and the
// in-memory gate passes: add ui runs `npm run typecheck` and `npm run
// test:sim` first (--skip-gate skips them). The create-time choices go to
// ui/new-ui.json, and the hashes of the UI's template-owned files to
// mnkit.json, for `mnkit upgrade` (which merges ui/package.json instead).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileHash } from '../lib/scaffold.mjs';
import { fail, writeFiles } from '../lib/template.mjs';
import { UI_CONFIG, isUiOwned, planUi, uiDetails, uiWarnings } from '../lib/ui.mjs';

const posix = (p) => p.split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, value) => fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);

/** Runs `npm <args>` in dir with the output shown; returns whether it passed. */
const npm = (dir, args) => spawnSync('npm', args, { cwd: dir, stdio: 'inherit' }).status === 0;

/**
 * Scaffolds ui/ in the standalone project `dir` (or with dryRun, prints what
 * it would generate). Returns the plan (lib/ui.mjs planUi).
 */
export function addUi(
  dir,
  { name, contract = null, privateState = null, dryRun = false, skipGate = false, skipInstall = false, run = npm },
) {
  const manifestPath = path.join(dir, 'mnkit.json');
  if (!fs.existsSync(manifestPath)) fail('run this from a project mnkit init created (one with a mnkit.json).');
  const uiDir = path.join(dir, 'ui');
  if (!dryRun && fs.existsSync(uiDir)) fail('ui/ already exists. mnkit upgrade re-renders its template-owned files.');

  if (!dryRun && !skipGate) {
    console.log('▶ In-memory gate: npm run typecheck, then npm run test:sim');
    if (!run(dir, ['run', 'typecheck']) || !run(dir, ['run', 'test:sim'])) {
      fail('the in-memory gate failed: fix typecheck and test:sim first (or pass --skip-gate).');
    }
  }

  const plan = planUi(dir, { name, mode: 'standalone', contract, privateState });
  const keys = path.join(dir, 'contract', 'managed', plan.managed, 'keys');
  if (!dryRun && !fs.existsSync(keys)) {
    fail(`contract/managed/${plan.managed} has no proving keys, which the browser needs: run npm run compile (not compile:fast).`);
  }

  console.log(
    dryRun
      ? `\n  Dry run: ui/ from contract/managed/${plan.managed} (nothing written)`
      : `\n✔ Scaffolded ui/ from contract/managed/${plan.managed}`,
  );
  console.log(uiDetails(plan));
  if (!dryRun) {
    writeFiles(uiDir, plan.files);
    fs.writeFileSync(path.join(uiDir, UI_CONFIG), plan.configContent);

    const pkgPath = path.join(dir, 'package.json');
    const pkg = readJson(pkgPath);
    const workspaces = pkg.workspaces ?? [];
    if (!workspaces.includes('ui')) writeJson(pkgPath, { ...pkg, workspaces: [...workspaces, 'ui'] });

    const manifest = readJson(manifestPath);
    const uiHashes = Object.fromEntries(
      plan.files.filter(isUiOwned).map((f) => [`ui/${posix(f.rel)}`, fileHash(f.content)]),
    );
    const files = { ...manifest.files, ...uiHashes };
    writeJson(manifestPath, {
      ...manifest,
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    });

    console.log(`\n  ${plan.files.length} files created. Seed files (yours to edit):`);
    for (const f of plan.files.filter((f) => f.seed)) console.log(`    ui/${posix(f.rel)}`);
  }
  for (const line of uiWarnings(plan)) console.log(line);
  if (dryRun) {
    console.log('\n  Nothing written. Rerun without --dry-run to create ui/.\n');
    return plan;
  }
  if (!skipInstall) {
    console.log('\n▶ npm install (ui is a workspace of the project)');
    if (!run(dir, ['install'])) fail('npm install failed. Fix the problem and run it again in the project.');
  }
  console.log('\n  Next steps:');
  if (skipInstall) console.log('    0. npm install');
  console.log('    1. npm run typecheck --workspace ui && npm run test:unit --workspace ui && npm run build --workspace ui');
  console.log('    2. npm run env:up && npm run wait:dust, then npm run dev --workspace ui (http://localhost:5173)');
  console.log('    3. Build the use case into the seed files above');
  console.log('    4. Work through the verification checklist in ui/AGENTS.md');
  console.log('');
  return plan;
}
