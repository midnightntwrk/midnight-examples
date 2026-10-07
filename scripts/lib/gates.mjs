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

// Gate state for one example, shared by validate-example, new-ui and the
// pipeline runner. Zero dependencies — Node built-ins only.
//
// A gate that passes writes a stamp under examples/<name>/.gates/ (gitignored)
// holding the hash of the sources it ran against. A later step trusts the
// stamp only while that hash still matches, so an edit after the gate ran
// invalidates it without anyone having to remember to.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GATES_DIR = '.gates';

/** Every file under `dir` matching `pred`, skipping managed/, node_modules/ and ui/. */
export function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['managed', 'node_modules', 'ui', GATES_DIR].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, pred, out);
    else if (pred(entry.name)) out.push(p);
  }
  return out;
}

/**
 * The files a contract-level gate depends on: the Compact sources, the
 * contract's TypeScript (witnesses, index), the test harness and tests, the
 * helper scripts (wait-for-dust) and the package/test config. ui/ is left
 * out on purpose: UI work must not invalidate the in-memory or devnet stamps.
 */
export function sourceFiles(exampleDir) {
  const ts = (n) => n.endsWith('.ts');
  return [
    ...walk(path.join(exampleDir, 'contract'), (n) => n.endsWith('.compact') || ts(n)),
    ...walk(path.join(exampleDir, 'src'), ts),
    ...walk(path.join(exampleDir, 'scripts'), ts),
    ...['package.json', 'vitest.config.ts'].map((f) => path.join(exampleDir, f)).filter((p) => fs.existsSync(p)),
  ].sort();
}

/** sha256 over the relative path and content of every source file, in sorted order. */
export function sourceHash(exampleDir) {
  const h = crypto.createHash('sha256');
  for (const p of sourceFiles(exampleDir)) {
    h.update(path.relative(exampleDir, p).split(path.sep).join('/'));
    h.update('\0');
    h.update(fs.readFileSync(p));
    h.update('\0');
  }
  return h.digest('hex');
}

/** contract/managed/<c>/compiler/contract-info.json for every compiled contract. */
export function contractInfos(exampleDir) {
  const managedDir = path.join(exampleDir, 'contract', 'managed');
  if (!fs.existsSync(managedDir)) return [];
  return fs
    .readdirSync(managedDir)
    .map((d) => path.join(managedDir, d, 'compiler', 'contract-info.json'))
    .filter((p) => fs.existsSync(p));
}

/**
 * True when a full `compile` is needed: nothing compiled yet, a compiled
 * contract with proving circuits has no keys/ (`compile:fast` output, which the
 * devnet tests and the UI's copy:zk can't use), or a .compact is newer than
 * the oldest contract-info.json.
 */
export function compileIsStale(exampleDir) {
  const infos = contractInfos(exampleDir);
  if (infos.length === 0) return true;
  const missingKeys = infos.some((p) => {
    const managed = path.dirname(path.dirname(p));
    const proves = JSON.parse(fs.readFileSync(p, 'utf8')).circuits?.some((c) => c.proof);
    return proves && !fs.existsSync(path.join(managed, 'keys'));
  });
  if (missingKeys) return true;
  const sources = walk(path.join(exampleDir, 'contract'), (n) => n.endsWith('.compact'));
  const newestSource = Math.max(...sources.map((p) => fs.statSync(p).mtimeMs));
  const oldestOutput = Math.min(...infos.map((p) => fs.statSync(p).mtimeMs));
  return newestSource > oldestOutput;
}

/** Absolute path of a file under the example's .gates/ directory. */
export function gatePath(exampleDir, file) {
  return path.join(exampleDir, GATES_DIR, file);
}

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The failing tests in a vitest JSON report (the Jest-compatible shape written
 * by `--reporter=json --outputFile.json=…`), with the first lines of each
 * failure message. A file that failed before any test ran (an import error, a
 * beforeAll throw) is reported with its file-level message.
 */
export function vitestFailures(report, exampleDir, maxLines = 8) {
  if (!report?.testResults) return [];
  const firstLines = (msg) => String(msg ?? '').split('\n').slice(0, maxLines).join('\n');
  const out = [];
  for (const file of report.testResults) {
    const rel = path.relative(exampleDir, file.name ?? '');
    const failed = (file.assertionResults ?? []).filter((a) => a.status === 'failed');
    for (const a of failed) out.push({ file: rel, test: a.fullName ?? a.title, message: firstLines(a.failureMessages?.[0]) });
    if (failed.length === 0 && file.status === 'failed') out.push({ file: rel, test: null, message: firstLines(file.message) });
  }
  return out;
}
