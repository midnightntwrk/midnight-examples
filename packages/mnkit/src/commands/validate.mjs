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

// The devnet gate for one project: compile → env:up → wait:dust → test:local,
// then env:down (`mnkit validate`; `npm run validate` in the monorepo's examples).
// It returns the status of the first step that failed, so a red test run is
// never reported as a pass.
//
//   keepNet     leave the network running afterwards. `env:up` is a no-op on a
//               healthy network, so a fix loop of `validate --keep-net` skips
//               the network restart; run env:down when done.
//   reportPath  also write a JSON report: each step's status and time, the
//               source hash at the start and the end (lib/gates.mjs), the
//               failing tests from vitest's JSON reporter, and the tail of each
//               failed step's output and of logs/compose.log. The monorepo's
//               pipeline runner runs validate in the background with this and
//               triages a failure from it. Output and exit status are
//               otherwise unchanged.
//
// `compile` is skipped when every contract/managed/*/compiler/contract-info.json
// is newer than every .compact under contract/, because a full compile
// regenerates the proving keys and is the slowest step after the tests.
//
// Ctrl-C or SIGTERM stops the running step, then cleans up as after a failed step: the service logs, env:down unless
// keepNet, and the report. It returns 128 + the signal's number (130, 143). A
// second signal during the cleanup exits at once.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileIsStale, readJson, sourceHash, vitestFailures, writeJson } from '../lib/gates.mjs';

/** Lines of output kept per step for the report. */
const TAIL_LINES = 60;
const tail = (text, n = TAIL_LINES) => text.split('\n').slice(-n).join('\n').trimEnd();

/**
 * Run `npm run <script> [-- ...extra]`. Without a report the child inherits the
 * terminal. With one, output is teed to ours and its tail kept for the report.
 * `onChild` gets the child while it runs (and null after), so a signal can be
 * passed on to it.
 *
 * Each step runs in its own process group, and stopSteps signals the whole
 * group: npm passes a signal to the script's shell, but not to what that shell
 * started (docker compose, vitest), which would keep running and, with a
 * report, keep the output pipe open. The steps don't read stdin; a step in a
 * background group that read the terminal would be stopped.
 */
function runScript({ dir, reportPath, onChild }, script, extra = []) {
  const [cmd, cmdArgs] = ['npm', ['run', script, ...(extra.length ? ['--', ...extra] : [])]];
  console.log(`\n▶ ${cmd} ${cmdArgs.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: dir,
      stdio: ['ignore', reportPath ? 'pipe' : 'inherit', reportPath ? 'pipe' : 'inherit'],
      detached: true,
    });
    onChild(child);
    let output = '';
    const keep = (chunk, sink) => {
      sink.write(chunk);
      output = tail(output + chunk.toString(), TAIL_LINES * 4);
    };
    child.stdout?.on('data', (c) => keep(c, process.stdout));
    child.stderr?.on('data', (c) => keep(c, process.stderr));
    const done = (result) => {
      onChild(null);
      resolve(result);
    };
    child.on('error', (err) => done({ status: 1, output: String(err) }));
    child.on('close', (code) => done({ status: code ?? 1, output }));
  });
}

const SIGNALS = ['SIGINT', 'SIGTERM'];

/** Sends `signal` to `child`'s process group (runScript), or to it alone if that fails. */
function stopStep(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Runs the gate in project dir `dir` and returns the exit status of the first
 * failed step, or 0.
 */
export async function validate({ dir, keepNet = false, reportPath = null }) {
  let child = null;
  let interrupted = null;
  const onSignal = (signal) => {
    if (interrupted) process.exit(128 + os.constants.signals[signal]);
    interrupted = signal;
    console.error(`\n✖ ${signal}: stopping, then cleaning up (${signal} again to quit at once).`);
    if (child) stopStep(child, signal);
  };
  for (const s of SIGNALS) process.on(s, onSignal);
  try {
    return await gate({ dir, keepNet, reportPath, interrupted: () => interrupted, onChild: (c) => (child = c) });
  } finally {
    for (const s of SIGNALS) process.off(s, onSignal);
  }
}

async function gate({ dir, keepNet, reportPath, interrupted, onChild }) {
  const run = (script, extra) => runScript({ dir, reportPath, onChild }, script, extra);
  const vitestReport = reportPath ? path.join(path.dirname(reportPath), 'devnet-vitest.json') : null;
  const extraArgs = {
    // CLI reporters replace the config's ['default'], so name it again.
    'test:local': vitestReport ? ['--reporter=default', '--reporter=json', `--outputFile.json=${vitestReport}`] : [],
  };

  const report = {
    example: path.basename(dir),
    startedAt: new Date().toISOString(),
    sourceHashStart: sourceHash(dir),
    keepNet,
    steps: [],
  };
  if (vitestReport) fs.rmSync(vitestReport, { force: true });

  const steps = [...(compileIsStale(dir) ? ['compile'] : []), 'env:up', 'wait:dust', 'test:local'];
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
      status = interrupted() ? 128 + os.constants.signals[interrupted()] : r.status;
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
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
      const logs = spawnSync('docker', ['compose', 'logs', '--no-color', '--timestamps'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'logs', 'compose.log'), logs.stdout ?? '');
      report.composeLogTail = tail(logs.stdout?.toString() ?? '');
    }
    if (!keepNet && failed !== 'compile') await run('env:down');
  }

  if (reportPath) {
    const tests = vitestReport ? readJson(vitestReport) : null;
    Object.assign(report, {
      finishedAt: new Date().toISOString(),
      sourceHashEnd: sourceHash(dir),
      passed: !failed,
      failedStep: failed,
      interrupted: interrupted(),
      exitCode: status,
      networkLeftUp: keepNet && failed !== 'compile',
      tests: tests
        ? {
            total: tests.numTotalTests,
            passed: tests.numPassedTests,
            failed: tests.numFailedTests,
            failures: vitestFailures(tests, dir),
          }
        : null,
    });
    writeJson(reportPath, report);
  }

  if (failed) {
    const logNote = failed === 'compile' ? '' : ' Service logs: logs/compose.log.';
    const what = interrupted() ? `was stopped by ${interrupted()} during` : 'failed at';
    console.error(`\n✖ validate ${what} \`${failed}\` (exit ${status}).${logNote}`);
    return status;
  }
  console.log(`\n✔ validate passed${keepNet ? ' (network left running; `npm run env:down` when done)' : ''}`);
  return 0;
}
