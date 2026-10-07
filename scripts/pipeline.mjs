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

// The generation pipeline runner (docs/generation-flow.md):
//
//   yarn pipeline <name> [--json] [--until sim] [--no-ui] [--retry-devnet]
//   yarn pipeline <name> --wait-devnet [--json]
//   yarn pipeline <name> --cancel-devnet
//
// It never writes contract, test or UI code and never calls a model. Each run
// works out from the files on disk how far examples/<name> has got, runs the
// scripts and gates that come next, and stops at the first failing gate or
// unfinished reasoning step with a `next` action: the step to go back to, the
// gate output, the files to edit and what to read. An agent drives the fix
// loop: run it, do what `next` says, run it again.
//
// Order:
//   1 spec lint (design) → 3a contract written? → compile:fast → 3b --derive
//   → in-memory gate: typecheck, test:sim, spec lint (code) → .gates/sim.json
//   → full compile (proving keys, for the devnet and the UI's copy:zk)
//   → 5 new:ui + yarn install, if there's no ui/ yet
//   → 4 devnet, started in the BACKGROUND: validate --keep-net --report
//   → 6 UI gates: typecheck, test:unit, build, new:ui --check
//   → docs: no TODO left in README.md / AGENTS.md
//   → join: the devnet must have passed on the current sources → 7 serve
//
// The in-memory gate, not the devnet, unlocks the UI: the devnet takes minutes
// (mostly real proving in test:local) and runs while the UI is written. It is
// still required before the example is done. If it fails, the pipeline writes
// a fix plan (.gates/devnet-fix.md, scripts/lib/devnet-triage.mjs) and puts it
// in `next`.
//
// The background run holds .gates/devnet.lock. While it runs, nothing here
// compiles (a compile would delete the proving keys under the running tests).
// A change to the contract-level sources (contract/, src/, package.json; ui/
// doesn't count) makes the run stale: the next pipeline run cancels it and,
// once the in-memory gate passes again, starts a fresh one. new:ui and
// `yarn install` run before the devnet starts, so the install never rewrites
// node_modules under a running test.
//
//   --json          print one JSON object: { example, steps, devnet, pending, next };
//                   next.kind is reason | infra | wait | pass | done (| until)
//   --until sim     stop after the in-memory gate (CI's scaffold job)
//   --no-ui         skip steps 5 and 6 (an example without a browser UI)
//   --retry-devnet  restart a devnet run that failed on the current sources
//                   (an infrastructure failure: ports, DUST, a timeout)
//   --wait-devnet   block until the background run finishes, then report it.
//                   Run it in the background to be told when the devnet is done
//   --cancel-devnet stop the background run and remove its lock (the network
//                   stays up; `yarn env:down` in the example takes it down)
//
// Every gate it runs is appended to examples/<name>/logs/pipeline.jsonl.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCompiled } from './lib/contract-info.mjs';
import { fixPlanMarkdown, triage } from './lib/devnet-triage.mjs';
import {
  compileIsStale,
  contractInfos,
  gatePath,
  readJson,
  sourceHash,
  walk,
  writeJson,
} from './lib/gates.mjs';
import { checkDocker, preflight } from './lib/preflight.mjs';
import { lintCode, lintDesign } from './lib/spec-lint.mjs';
import { NAME_RE, fail } from './lib/template.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE =
  'Usage: yarn pipeline <name> [--json] [--until sim] [--no-ui] [--retry-devnet] | <name> --wait-devnet | <name> --cancel-devnet';

// --- args ----------------------------------------------------------------------
const opts = { json: false, until: null, ui: true, retry: false, wait: false, cancel: false, name: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opts.json = true;
  else if (a === '--until' && argv[i + 1] === 'sim') opts.until = argv[++i];
  else if (a === '--no-ui') opts.ui = false;
  else if (a === '--retry-devnet') opts.retry = true;
  else if (a === '--wait-devnet') opts.wait = true;
  else if (a === '--cancel-devnet') opts.cancel = true;
  else if (!a.startsWith('-') && !opts.name) opts.name = a;
  else fail(`unknown or incomplete argument: ${a}. ${USAGE}`);
}
if (!opts.name) fail(USAGE);
if (!NAME_RE.test(opts.name)) fail(`invalid name '${opts.name}' (kebab-case, e.g. hello-world)`);

const name = opts.name;
const DIR = path.join(REPO_ROOT, 'examples', name);
const UI_DIR = path.join(DIR, 'ui');
const UI_PKG = `@midnight-ntwrk/example-${name}-ui`;
const rel = (p) => path.relative(REPO_ROOT, p);
const LOCK = gatePath(DIR, 'devnet.lock');
const REPORT = gatePath(DIR, 'devnet.json');
const SIM_STAMP = gatePath(DIR, 'sim.json');
const SEEDS = gatePath(DIR, 'ui-seeds.json');

// What to read when sent back to a step: the context budget in
// docs/generation-flow.md, by step.
const READ = {
  1: ['templates/example/SPEC.md', 'examples/private-tip-jar/SPEC.md (a worked example)', 'docs/patterns.md (find the nearest example)'],
  '3a': [
    'docs/compact-gotchas.md',
    'docs/patterns.md, then the 1–2 nearest examples’ contract/*.compact',
    `examples/${name}/SPEC.md`,
  ],
  '3c': [
    'the derived stubs in contract/witnesses.ts and src/test/',
    'examples/calculator/src/test/calculator.sim.test.ts and examples/private-tip-jar/src/test/private-tip-jar.sim.test.ts',
    'the nearest examples’ contract/witnesses.ts and test bodies after "Your tests begin here"',
    'packages/sim/src/sim.ts and privacy.ts, only if you need more of the in-memory API',
  ],
  gate: ['the gate output in this report first', 'docs/compact-gotchas.md', 'then the midnight-expert skills (compact-core, midnight-verify)'],
  6: ['templates/ui/AGENTS.md: §3, §5 and the Gotchas', 'the nearest examples/*/ui seed files (listed under its "Worked examples")'],
};

// --- reporting -----------------------------------------------------------------
const state = { example: name, steps: [], devnet: null, pending: [], next: null };
const ICON = { pass: '✔', fail: '✖', skipped: '•', fresh: '•', pending: '…', running: '⏳', waiting: '⏳' };
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function step(id, status, extra = {}) {
  state.steps.push({ id, status, ...extra });
  if (!opts.json) {
    const ms = extra.ms !== undefined ? ` (${(extra.ms / 1000).toFixed(1)} s)` : '';
    console.log(`${ICON[status] ?? '·'} ${id}: ${status}${extra.note ? `, ${extra.note}` : ''}${ms}`);
  }
}

/** The useful part of a gate's output: TypeScript errors if any, else the tail. */
function trimOutput(out, lines = 40) {
  const all = stripAnsi(out).split('\n');
  const ts = all.filter((l) => /error TS\d+/.test(l));
  return (ts.length ? ts.slice(0, 25) : all.slice(-lines)).join('\n').trim();
}

function log(entry) {
  fs.mkdirSync(path.join(DIR, 'logs'), { recursive: true });
  fs.appendFileSync(path.join(DIR, 'logs', 'pipeline.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/** Run a command to completion, capturing its output. */
function run(id, cmd, args, cwd = DIR) {
  if (!opts.json) console.log(`▶ ${id}: ${[cmd, ...args].join(' ')}`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const ms = Date.now() - t0;
  const status = r.status ?? 1;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
  log({ step: id, status: status === 0 ? 'pass' : 'fail', ms });
  return { ok: status === 0, ms, output };
}

/** Print the result and exit: 0 when done, only waiting on the devnet, or (--wait-devnet) it passed; 1 otherwise. */
function finish() {
  const ok = ['done', 'wait', 'pass'].includes(state.next?.kind);
  if (opts.json) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    if (state.devnet) console.log(`\nDevnet: ${describeDevnet(state.devnet)}`);
    if (state.pending.length) console.log(`Pending: ${state.pending.join('; ')}`);
    const n = state.next;
    if (n) {
      console.log(`\nNext${n.step ? ` (step ${n.step})` : ''}: ${n.reason}`);
      if (n.problems?.length) for (const p of n.problems) console.log(`  - ${p}`);
      if (n.actions?.length) n.actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
      if (n.output) console.log(`\n${n.output.split('\n').map((l) => `  │ ${l}`).join('\n')}\n`);
      if (n.run?.length) for (const c of n.run) console.log(`  $ ${c}`);
      if (n.edit?.length) console.log(`  Edit: ${n.edit.join(', ')}`);
      if (n.read?.length) console.log(`  Read: ${n.read.join('; ')}`);
      if (n.fixPlan) console.log(`  Fix plan: ${n.fixPlan}`);
    }
  }
  process.exit(ok || (opts.until && state.next?.kind === 'until') ? 0 : 1);
}

function stop(next) {
  state.next = next;
  finish();
}

// --- the background devnet -------------------------------------------------------
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Where the background run stands:
 *   running  a live validate holds the lock
 *   passed / failed   the last run's report, for `sourceHash`
 *   none     no run yet
 * A dead lock with no newer report means validate was killed or crashed; a
 * synthetic failed report records that, so the state survives the lock.
 */
function devnetStatus() {
  const lock = readJson(LOCK);
  if (lock && alive(lock.pid)) return { status: 'running', pid: lock.pid, sourceHash: lock.sourceHash, startedAt: lock.startedAt };
  let report = readJson(REPORT);
  if (lock) {
    if (!report || report.startedAt < lock.startedAt) {
      report = { crashed: true, passed: false, failedStep: null, sourceHashStart: lock.sourceHash, sourceHashEnd: lock.sourceHash, startedAt: lock.startedAt };
      writeJson(REPORT, report);
    }
    // First sight of the finished run: log it once, with its own step times.
    log({
      step: 'devnet',
      status: report.passed ? 'pass' : 'fail',
      ms: report.finishedAt ? Date.parse(report.finishedAt) - Date.parse(report.startedAt) : undefined,
      failedStep: report.failedStep ?? undefined,
      steps: report.steps?.map((s) => ({ step: s.step, status: s.status, ms: s.ms })),
      tests: report.tests ? { passed: report.tests.passed, total: report.tests.total } : undefined,
    });
    fs.rmSync(LOCK, { force: true });
  }
  if (!report) return { status: 'none' };
  // Sources edited mid-run: the result belongs to neither version.
  const sourceHash = report.sourceHashEnd === report.sourceHashStart ? report.sourceHashStart : null;
  return { status: report.passed ? 'passed' : 'failed', sourceHash, report };
}

function describeDevnet(d) {
  if (d.status === 'running') return `running (pid ${d.pid}, started ${d.startedAt}; log: ${rel(path.join(DIR, 'logs', 'devnet.log'))})`;
  if (d.status === 'passed') return `passed${d.stale ? ' on older sources (stale)' : `, ${d.report?.tests?.passed ?? '?'} tests`}`;
  if (d.status === 'failed') return `failed at ${d.report?.failedStep ?? 'an unknown step'}${d.stale ? ' on older sources (stale)' : ''}`;
  return d.status;
}

function cancelDevnet(reason) {
  const lock = readJson(LOCK);
  if (lock && alive(lock.pid)) {
    try {
      process.kill(-lock.pid, 'SIGTERM'); // the whole process group: yarn, vitest, docker compose
    } catch {
      process.kill(lock.pid, 'SIGTERM');
    }
    log({ step: 'devnet', status: 'cancelled', reason });
  }
  fs.rmSync(LOCK, { force: true });
  fs.rmSync(REPORT, { force: true });
}

function startDevnet(hash) {
  fs.rmSync(REPORT, { force: true });
  fs.rmSync(gatePath(DIR, 'devnet-fix.md'), { force: true });
  fs.mkdirSync(path.join(DIR, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(DIR, 'logs', 'devnet.log'), 'w');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'validate-example.mjs'), '--keep-net', '--report', REPORT], {
    cwd: DIR,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  child.unref();
  const lock = { pid: child.pid, sourceHash: hash, startedAt: new Date().toISOString() };
  writeJson(LOCK, lock);
  log({ step: 'devnet', status: 'started', pid: child.pid });
  return { status: 'running', ...lock };
}

/** For a failed run: write the fix plan, and return the `next` action for it. */
function devnetFailureNext(d) {
  const plan = triage(d.report, name);
  const fixPath = gatePath(DIR, 'devnet-fix.md');
  fs.writeFileSync(fixPath, fixPlanMarkdown(plan, name, d.report));
  return {
    kind: plan.kind === 'infra' ? 'infra' : 'reason',
    step: plan.route === '4' ? '4' : plan.route,
    reason: `the devnet failed at ${plan.failedStep ?? 'an unknown step'}: ${plan.cause}`,
    actions: plan.actions,
    uiAffected: plan.uiAffected,
    failures: plan.failures,
    fixPlan: rel(fixPath),
    run: plan.kind === 'infra' ? [`yarn pipeline ${name} --retry-devnet`] : [],
    edit:
      plan.route === '3a'
        ? [`examples/${name}/contract/${name}.compact`]
        : plan.kind === 'infra'
          ? []
          : [
              plan.failures[0] ? `examples/${name}/${plan.failures[0].file}` : `examples/${name}/src/test/`,
              ...(plan.class === 'proof' ? [`examples/${name}/contract/witnesses.ts`] : []),
            ],
    read: plan.read,
  };
}

// --- one-shot modes -------------------------------------------------------------
if (!fs.existsSync(path.join(DIR, 'package.json'))) {
  if (opts.wait || opts.cancel) fail(`examples/${name} does not exist`);
  stop({
    kind: 'reason',
    step: '1',
    reason: `examples/${name} does not exist: write the design card (SPEC.md) and have it reviewed, then scaffold from it`,
    run: [`yarn spec:lint --file <card.md> [--witnesses]`, `yarn new:example ${name} --spec <card.md> [--witnesses]`],
    read: READ[1],
  });
}

if (opts.cancel) {
  cancelDevnet('--cancel-devnet');
  console.log(`✔ background devnet for ${name} cancelled (the network is still up: \`yarn env:down\` in examples/${name})`);
  process.exit(0);
}

if (opts.wait) {
  let d = devnetStatus();
  if (d.status === 'none') fail(`no background devnet run for ${name}. Start one with \`yarn pipeline ${name}\`.`);
  while (d.status === 'running') {
    await new Promise((r) => setTimeout(r, 5000));
    d = devnetStatus();
  }
  d.stale = d.sourceHash !== sourceHash(DIR);
  state.devnet = d;
  if (d.status === 'passed' && !d.stale) state.next = { kind: 'pass', reason: `the devnet passed on the current sources. Run \`yarn pipeline ${name}\` to finish` };
  else if (d.stale) state.next = { kind: 'reason', reason: `the run finished on older sources; run \`yarn pipeline ${name}\` to start a fresh one` };
  else state.next = devnetFailureNext(d);
  finish();
}

// --- the pipeline ---------------------------------------------------------------
preflight(REPO_ROOT, { compact: true });
// Recomputed after --derive, which can rewrite a stub region in the tests.
let hash = sourceHash(DIR);

// A run on older contract-level sources can't tell us anything: stop it now,
// before anything below compiles under it.
const before = devnetStatus();
if (before.status === 'running' && before.sourceHash !== hash) {
  cancelDevnet('sources changed');
  if (!opts.json) console.log('• devnet: cancelled the background run (the contract, witnesses or tests changed since it started)');
}

// 1 · the design card
const spec = path.join(DIR, 'SPEC.md');
const designProblems = fs.existsSync(spec) ? lintDesign(fs.readFileSync(spec, 'utf8')) : ['SPEC.md is missing'];
log({ step: 'spec', status: designProblems.length ? 'fail' : 'pass' });
if (designProblems.length) {
  step('spec', 'fail');
  stop({ kind: 'reason', step: '1', reason: 'SPEC.md fails the design lint; fill it in and have it reviewed', problems: designProblems, edit: [rel(spec)], read: READ[1] });
}
step('spec', 'pass');

// 3a · a contract beyond the template stub (the stub declares no circuit)
const sources = walk(path.join(DIR, 'contract'), (n) => n.endsWith('.compact'));
const code = sources.map((p) => fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
if (!/\bcircuit\b/.test(code)) {
  step('contract', 'pending');
  stop({
    kind: 'reason',
    step: '3a',
    reason: 'write the contract: it is still the template stub',
    edit: [`examples/${name}/contract/${name}.compact`],
    read: READ['3a'],
  });
}

// compile:fast, when a .compact is newer than its compiled output
const infos = contractInfos(DIR);
const compiledOutOfDate =
  infos.length === 0 ||
  Math.max(...sources.map((p) => fs.statSync(p).mtimeMs)) > Math.min(...infos.map((p) => fs.statSync(p).mtimeMs));
if (compiledOutOfDate && devnetStatus().status === 'running') {
  // Same source hash as the run (else it was cancelled above): the .compact was
  // touched, not changed. Compiling would delete the keys under the run.
  step('compile:fast', 'skipped', { note: 'the background devnet run holds the lock; the sources are unchanged' });
} else if (compiledOutOfDate) {
  const r = run('compile:fast', 'yarn', ['compile:fast']);
  step('compile:fast', r.ok ? 'pass' : 'fail', { ms: r.ms });
  if (!r.ok) stop({ kind: 'reason', step: '3a', reason: 'the contract does not compile', output: trimOutput(r.output), edit: sources.map(rel), read: READ.gate });
} else step('compile:fast', 'skipped', { note: 'compiled output is newer than every .compact' });

// 3b · derive (idempotent: only unedited stub regions change)
{
  const r = run('derive', 'node', [path.join(REPO_ROOT, 'scripts', 'new-example.mjs'), name, '--derive']);
  step('derive', r.ok ? 'pass' : 'fail', { ms: r.ms });
  if (!r.ok) stop({ kind: 'reason', step: '3a', reason: '--derive refused the compiled contract', output: trimOutput(r.output), read: READ.gate });
  // Derive rewrote a region (new circuit, constructor or factory parameter):
  // the stamps below must hold the hash of what the gates actually ran on.
  const derived = sourceHash(DIR);
  if (derived !== hash) {
    hash = derived;
    const d = devnetStatus();
    if (d.status === 'running' && d.sourceHash !== hash) cancelDevnet('derive changed the sources');
  }
}

// The in-memory gate. A stamp for the current sources means it already passed.
const simStamp = readJson(SIM_STAMP);
if (simStamp?.sourceHash === hash) {
  for (const id of ['typecheck', 'test:sim', 'spec:code']) step(id, 'fresh', { note: 'passed on these sources' });
} else {
  fs.rmSync(SIM_STAMP, { force: true });
  const edit3c = [`examples/${name}/contract/witnesses.ts`, `examples/${name}/src/test/${name}.sim.test.ts`, `examples/${name}/src/test/${name}.test.ts`];
  let r = run('typecheck', 'yarn', ['typecheck']);
  step('typecheck', r.ok ? 'pass' : 'fail', { ms: r.ms });
  if (!r.ok) {
    stop({
      kind: 'reason',
      step: '3c',
      reason: 'typecheck failed (after changing the contract or the private-state factory, re-run --derive: the pipeline does)',
      output: trimOutput(r.output),
      edit: edit3c,
      read: [...READ.gate, ...READ['3c']],
    });
  }
  const simReport = gatePath(DIR, 'sim-vitest.json');
  fs.rmSync(simReport, { force: true });
  r = run('test:sim', 'yarn', ['test:sim', '--reporter=default', '--reporter=json', `--outputFile.json=${simReport}`]);
  const sim = readJson(simReport);
  const simTests = sim?.numTotalTests ?? 0;
  const simOk = r.ok && simTests > 0;
  step('test:sim', simOk ? 'pass' : 'fail', { ms: r.ms, note: `${sim?.numPassedTests ?? 0}/${simTests} tests` });
  if (!simOk) {
    stop({
      kind: 'reason',
      step: '3c',
      reason:
        simTests === 0
          ? 'no sim tests ran: write src/test/*.sim.test.ts'
          : /is not implemented/.test(r.output)
            ? 'implement the witness stubs in contract/witnesses.ts and write the tests (3c)'
            : 'the in-memory tests failed',
      output: trimOutput(r.output),
      edit: edit3c,
      // A first entry to 3c is writing, not debugging: the 3c models come first.
      read: [...READ['3c'], ...READ.gate.slice(1)],
    });
  }
  const problems = lintCode(DIR);
  log({ step: 'spec:code', status: problems.length ? 'fail' : 'pass' });
  step('spec:code', problems.length ? 'fail' : 'pass');
  if (problems.length) {
    stop({
      kind: 'reason',
      step: '3c',
      reason: 'SPEC.md and the code disagree, or the sim tests leave something out',
      problems,
      edit: [rel(spec), ...edit3c],
      read: READ['3c'],
    });
  }
  writeJson(SIM_STAMP, { sourceHash: hash, at: new Date().toISOString(), simTests });
}
if (opts.until === 'sim') {
  stop({ kind: 'until', reason: 'the in-memory gate passed (stopped by --until sim)' });
}

// Full compile, for the devnet tests and the UI's copy:zk. Never while a run
// on these sources holds the lock (it compiled already, and would lose its keys).
let devnet = devnetStatus();
if (devnet.status === 'running') step('compile', 'skipped', { note: 'the background devnet run already compiled these sources' });
else if (compileIsStale(DIR)) {
  const r = run('compile', 'yarn', ['compile']);
  step('compile', r.ok ? 'pass' : 'fail', { ms: r.ms });
  if (!r.ok) stop({ kind: 'reason', step: '3a', reason: 'the full compile (with proving keys) failed', output: trimOutput(r.output), read: READ.gate });
} else step('compile', 'skipped', { note: 'proving keys are newer than every .compact' });

// 5 · the UI scaffold, before the devnet starts (yarn install rewrites node_modules)
const seedHash = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);
const seedFiles = [
  'README.md',
  `src/midnight/${name}-api.ts`,
  `src/components/${name}-panel.tsx`,
  `src/__tests__/${name}-circuits.test.ts`,
].map((f) => path.join(UI_DIR, f));
if (opts.ui && !fs.existsSync(UI_DIR)) {
  // Several compiled contracts (a test-only faucet beside the jar): the UI is
  // for the one named after the example, as --derive assumes.
  const contractArg = listCompiled(DIR).length > 1 && listCompiled(DIR).includes(name) ? ['--contract', name] : [];
  let r = run('new:ui', 'node', [path.join(REPO_ROOT, 'scripts', 'new-ui.mjs'), name, ...contractArg]);
  step('new:ui', r.ok ? 'pass' : 'fail', { ms: r.ms });
  if (!r.ok) stop({ kind: 'reason', step: '5', reason: 'new:ui refused; its message says what it needs', output: trimOutput(r.output) });
  writeJson(SEEDS, Object.fromEntries(seedFiles.map((p) => [rel(p), seedHash(p)])));
  r = run('install', 'yarn', ['install'], REPO_ROOT);
  step('install', r.ok ? 'pass' : 'fail', { ms: r.ms, note: 'the new UI workspace changes yarn.lock: commit it' });
  if (!r.ok) stop({ kind: 'infra', step: '5', reason: '`yarn install` failed after adding the UI workspace', output: trimOutput(r.output) });
} else if (!opts.ui) step('new:ui', 'skipped', { note: '--no-ui' });
else step('new:ui', 'skipped', { note: 'ui/ exists' });

// 4 · the devnet, in the background
devnet = devnetStatus();
if (devnet.status === 'running') {
  step('devnet', 'running', { note: `pid ${devnet.pid}` });
} else if ((devnet.status === 'passed' || devnet.status === 'failed') && devnet.sourceHash === hash && !(devnet.status === 'failed' && opts.retry)) {
  step('devnet', devnet.status === 'passed' ? 'pass' : 'fail', { note: 'on these sources' });
} else {
  const docker = checkDocker();
  if (docker) {
    step('devnet', 'fail', { note: docker });
    stop({ kind: 'infra', step: '4', reason: `the devnet can't start: ${docker}`, run: [`yarn pipeline ${name}`] });
  }
  devnet = startDevnet(hash);
  step('devnet', 'running', { note: `started in the background, pid ${devnet.pid}; log: ${rel(path.join(DIR, 'logs', 'devnet.log'))}` });
}
state.devnet = devnet;

// Everything below collects work instead of stopping at once, so one run
// reports the devnet, the UI and the docs together; `next` is the most
// pressing item.
const candidates = [];
if (devnet.status === 'failed') {
  const n = devnetFailureNext(devnet);
  state.pending.push(`devnet failed (fix plan: ${n.fixPlan})`);
  candidates.push({ rank: n.uiAffected ? 0 : 2, ...n });
}

// 6 · the UI: the seed files, then its gates
if (opts.ui && fs.existsSync(UI_DIR)) {
  const created = readJson(SEEDS);
  const untouched = created && seedFiles.every((p) => created[rel(p)] === seedHash(p));
  if (untouched) {
    step('ui', 'pending', { note: 'seed files unchanged since new:ui' });
    state.pending.push('UI seed files');
    candidates.push({
      rank: 1,
      kind: 'reason',
      step: '6',
      reason: 'build the use case into the UI seed files (the generated UI already passes its gates)',
      edit: seedFiles.map(rel),
      read: READ[6],
    });
  } else {
    const gates = [
      ['ui:typecheck', 'yarn', ['workspace', UI_PKG, 'typecheck']],
      ['ui:test:unit', 'yarn', ['workspace', UI_PKG, 'test:unit']],
      ['ui:build', 'yarn', ['workspace', UI_PKG, 'build']],
      ['ui:check', 'node', [path.join(REPO_ROOT, 'scripts', 'new-ui.mjs'), name, '--check']],
    ];
    for (const [id, cmd, args] of gates) {
      const r = run(id, cmd, args, REPO_ROOT);
      step(id, r.ok ? 'pass' : 'fail', { ms: r.ms });
      if (!r.ok) {
        state.pending.push(`${id} failed`);
        candidates.push({
          rank: 1,
          kind: 'reason',
          step: '6',
          reason: `${id} failed${id === 'ui:check' ? ': a template-owned file was edited; move that change into a seed file or templates/ui/' : ''}`,
          output: trimOutput(r.output),
          edit: seedFiles.map(rel),
          read: [...READ.gate, ...READ[6]],
        });
        break;
      }
    }
  }
}

// Docs: the scaffold's TODOs in the example's README.md and AGENTS.md, and its
// rows in the root tables.
const todos = [
  ...['README.md', 'AGENTS.md'].flatMap((f) => {
    const p = path.join(DIR, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => /\bTODO\b/.test(l)).map((l) => `examples/${name}/${f}: ${l.trim()}`) : [];
  }),
  ...['README.md', 'AGENTS.md'].flatMap((f) =>
    fs
      .readFileSync(path.join(REPO_ROOT, f), 'utf8')
      .split('\n')
      .filter((l) => (l.includes(`\`${name}\``) || l.includes(` ${name}/`)) && /\bTODO\b/.test(l))
      .map((l) => `${f}: ${l.trim()}`),
  ),
];
step('docs', todos.length ? 'pending' : 'pass', todos.length ? { note: `${todos.length} TODO(s)` } : {});
if (todos.length) {
  state.pending.push('docs TODOs');
  candidates.push({ rank: 3, kind: 'reason', step: 'docs', reason: 'replace the scaffold TODOs in the docs', problems: todos });
}

// Join: done only once the devnet passed on the current sources.
if (devnet.status === 'running') {
  state.pending.push('devnet running');
  candidates.push({
    rank: 4,
    kind: 'wait',
    step: '4',
    reason: 'the devnet is still running in the background; carry on, or wait for it',
    run: [`yarn pipeline ${name} --wait-devnet`],
  });
}
candidates.sort((a, b) => a.rank - b.rank);
if (candidates.length) {
  const { rank, ...next } = candidates[0];
  stop(next);
}
step('serve', 'pass');
stop({
  kind: 'done',
  step: '7',
  reason: `done: the in-memory gate, ${opts.ui ? 'the UI gates and ' : ''}the devnet passed on the current sources${
    devnet.report?.networkLeftUp ? '. The devnet is still up' : ''
  }`,
  run: opts.ui
    ? [`yarn workspace ${UI_PKG} dev`, 'yarn fund:wallet <mn_dust_…> [mn_addr_…]   # DUST (and NIGHT) for a browser wallet', `(cd examples/${name} && yarn env:down)   # when finished`]
    : [`(cd examples/${name} && yarn env:down)   # when finished`],
});
