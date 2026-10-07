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

// The devnet gate for one example: compile → env:up → wait:dust → test:local,
// then env:down. Every example's `validate` script runs this from its own
// directory:
//
//   yarn validate [--keep-net] [--report <file>]
//
// It exits with the status of the first step that failed, so a red test run
// is never reported as a pass. (The old one-liner `… && yarn test:local;
// yarn env:down` exited with env:down's status, which is almost always 0.)
//
//   --keep-net       leave the network running afterwards. `env:up` is a no-op
//                    on a healthy network, so a fix loop of `yarn validate
//                    --keep-net` skips the network restart; run `yarn env:down`
//                    when done.
//   --report <file>  also write a JSON report: each step's status and time, the
//                    source hash at the start and the end (scripts/lib/gates.mjs),
//                    the failing tests from vitest's JSON reporter, and the tail
//                    of each failed step's output and of logs/compose.log. The
//                    pipeline runner (scripts/pipeline.mjs) runs validate in the
//                    background with this and triages a failure from it. Output
//                    and exit status are otherwise unchanged.
//
// `compile` is skipped when every contract/managed/*/compiler/contract-info.json
// is newer than every .compact under contract/, because a full compile
// regenerates the proving keys and is the slowest step after the tests.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileIsStale, readJson, sourceHash, vitestFailures, writeJson } from './lib/gates.mjs';
import { preflight } from './lib/preflight.mjs';
import { fail } from './lib/template.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_DIR = process.cwd();
const USAGE = 'Usage: yarn validate [--keep-net] [--report <file>]';

const args = process.argv.slice(2);
let keepNet = false;
let reportPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keep-net') keepNet = true;
  else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) reportPath = path.resolve(args[++i]);
  else fail(`unknown or incomplete argument: ${args[i]}. ${USAGE}`);
}

if (!fs.existsSync(path.join(EXAMPLE_DIR, 'compose.yml'))) {
  fail('run this from an example directory (one with a compose.yml), via `yarn validate`.');
}
preflight(REPO_ROOT, { compact: true, docker: true });

/** Lines of output kept per step for the report. */
const TAIL_LINES = 60;
const tail = (text, n = TAIL_LINES) => text.split('\n').slice(-n).join('\n').trimEnd();

/**
 * Run `yarn <script> [...extra]`. Without --report the child inherits the
 * terminal. With it, output is teed to ours and its tail kept for the report.
 */
function run(script, extra = []) {
  console.log(`\n▶ yarn ${[script, ...extra].join(' ')}`);
  if (!reportPath) {
    const r = spawnSync('yarn', [script, ...extra], { stdio: 'inherit', cwd: EXAMPLE_DIR });
    return Promise.resolve({ status: r.status ?? 1, output: '' });
  }
  return new Promise((resolve) => {
    const child = spawn('yarn', [script, ...extra], { cwd: EXAMPLE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk, sink) => {
      sink.write(chunk);
      output = tail(output + chunk.toString(), TAIL_LINES * 4);
    };
    child.stdout.on('data', (c) => keep(c, process.stdout));
    child.stderr.on('data', (c) => keep(c, process.stderr));
    child.on('error', (err) => resolve({ status: 1, output: String(err) }));
    child.on('close', (code) => resolve({ status: code ?? 1, output }));
  });
}

const vitestReport = reportPath ? path.join(path.dirname(reportPath), 'devnet-vitest.json') : null;
const extraArgs = {
  // CLI reporters replace the config's ['default'], so name it again.
  'test:local': vitestReport ? ['--reporter=default', '--reporter=json', `--outputFile.json=${vitestReport}`] : [],
};

const report = {
  example: path.basename(EXAMPLE_DIR),
  startedAt: new Date().toISOString(),
  sourceHashStart: sourceHash(EXAMPLE_DIR),
  keepNet,
  steps: [],
};
if (vitestReport) fs.rmSync(vitestReport, { force: true });

const steps = [...(compileIsStale(EXAMPLE_DIR) ? ['compile'] : []), 'env:up', 'wait:dust', 'test:local'];
if (!steps.includes('compile')) {
  console.log('• compile skipped: contract/managed has proving keys and is newer than every .compact source');
  report.steps.push({ step: 'compile', status: 'skipped', ms: 0 });
}

let failed = null;
let status = 0;
try {
  for (const step of steps) {
    const t0 = Date.now();
    const r = await run(step, extraArgs[step]);
    status = r.status;
    const entry = { step, status: status === 0 ? 'pass' : 'fail', ms: Date.now() - t0 };
    if (status !== 0) entry.outputTail = tail(r.output);
    report.steps.push(entry);
    if (status !== 0) {
      failed = step;
      break;
    }
  }
} finally {
  if (failed && failed !== 'compile') {
    // Same as CI: keep the service logs, which env:down deletes with the containers.
    fs.mkdirSync(path.join(EXAMPLE_DIR, 'logs'), { recursive: true });
    const logs = spawnSync('docker', ['compose', 'logs', '--no-color', '--timestamps'], { cwd: EXAMPLE_DIR });
    fs.writeFileSync(path.join(EXAMPLE_DIR, 'logs', 'compose.log'), logs.stdout ?? '');
    report.composeLogTail = tail(logs.stdout?.toString() ?? '');
  }
  if (!keepNet && failed !== 'compile') await run('env:down');
}

if (reportPath) {
  const tests = vitestReport ? readJson(vitestReport) : null;
  Object.assign(report, {
    finishedAt: new Date().toISOString(),
    sourceHashEnd: sourceHash(EXAMPLE_DIR),
    passed: !failed,
    failedStep: failed,
    exitCode: status,
    networkLeftUp: keepNet && failed !== 'compile',
    tests: tests
      ? {
          total: tests.numTotalTests,
          passed: tests.numPassedTests,
          failed: tests.numFailedTests,
          failures: vitestFailures(tests, EXAMPLE_DIR),
        }
      : null,
  });
  writeJson(reportPath, report);
}

if (failed) {
  const logNote = failed === 'compile' ? '' : ' Service logs: logs/compose.log.';
  console.error(`\n✖ validate failed at \`${failed}\` (exit ${status}).${logNote}`);
  process.exit(status);
}
console.log(`\n✔ validate passed${keepNet ? ' (network left running; `yarn env:down` when done)' : ''}`);
