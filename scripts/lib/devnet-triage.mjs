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

// Turn a failed background devnet run (the `yarn validate --report` JSON) into
// a fix plan. Deterministic: it classifies by the failed step and the error
// text, it doesn't reason. Zero dependencies — Node built-ins only.
//
// The devnet only runs once the in-memory gate (typecheck, test:sim, the SPEC
// code checks) has passed, so the contract logic and every guard are already
// tested. A devnet failure is either infrastructure, or one of the things the
// in-memory Sim can't model: real proving, DUST fee balancing, shielded coin
// selection and Merkle paths, indexer and wallet sync timing, and several
// wallets with their own keys. The routes below follow from that.

/** Classes of test:local failure, matched in order against each failure's text. */
const TEST_CLASSES = [
  {
    id: 'timeout',
    re: /timed? ?out|timeout/i,
    kind: 'infra',
    route: '4',
    cause: 'a test or hook timed out: usually indexer or wallet sync timing on a busy machine',
    actions: ['rerun once: `yarn pipeline __name__ --retry-devnet`', 'if it times out again, treat it as a test-setup problem (3c): a wait that never resolves'],
    uiAffected: false,
  },
  {
    id: 'guard',
    re: /failed assert:/,
    kind: 'reason',
    route: '3c',
    cause:
      'a contract assert fired on the devnet that the sim tests expect to pass: the devnet test calls it with ' +
      'a different caller, private state or coin than the sim test does',
    actions: [
      'compare the devnet test call with the passing sim call: the wallet (coin public key) that calls it, the private state the providers hold, the coin it passes',
      'fix the devnet test (3c). Only if the sim test was wrong too, fix the contract (3a) and the sim test together',
    ],
    uiAffected: false,
  },
  {
    id: 'proof',
    re: /prove|proving|proof|zkir|prover key|verifier key|circuit/i,
    kind: 'reason',
    route: '3c',
    cause: 'proving failed: real proofs check every constraint, including witness values the sim test never produced',
    actions: [
      'find the witness value or argument the proof rejects (the sim runs the same circuit without proving, so look for a value only the devnet test produces)',
      'fix the witness (3c); if the circuit itself is wrong, fix the contract (3a), then re-run the in-memory gate',
    ],
    uiAffected: true,
  },
  {
    id: 'wallet',
    re: /balance|insufficient|dust|coin|utxo|SubmissionError|DoubleSpend|fee|nonce|merkle|sync/i,
    kind: 'reason',
    route: '3c',
    cause: 'wallet, fee or coin handling: DUST balancing, coin selection or a coin the wallet has not synced yet; the sim has none of these',
    actions: [
      'fix the devnet test setup (3c): fund and sync the wallet that pays, wait for a received coin before spending it, use one coin per transaction',
      'shielded flows: compare with the helpers above "Your tests begin here" in examples/private-tip-jar/src/test/private-tip-jar.test.ts',
    ],
    uiAffected: false,
  },
  {
    id: 'assertion',
    re: /AssertionError|expected .* to |toBe|toEqual|toStrictEqual/i,
    kind: 'reason',
    route: '3c',
    cause: "the devnet test's own expectation failed: the transaction landed, but the state it reads back differs",
    actions: [
      'compare the expectation with the matching sim test; ledger reads on the devnet go through the indexer, so read after the transaction is final',
      'fix the devnet test (3c)',
    ],
    uiAffected: false,
  },
];

const FALLBACK = {
  id: 'unknown',
  kind: 'reason',
  route: '3c',
  cause: 'unclassified test failure',
  actions: ['read the failure and logs/devnet.log; most devnet-only failures are in the devnet test setup (3c)'],
  uiAffected: false,
};

const READ_ON_FAILURE = [
  'the failing tests and output in this plan, then logs/devnet.log',
  'docs/compact-gotchas.md',
  'logs/compose.log (node, indexer, proof server) if the failure points at the network',
  'then the midnight-expert skills (compact-core, midnight-verify)',
];

/**
 * A fix plan for a failed report:
 *   { kind: 'infra'|'reason', route, cause, actions[], read[], uiAffected, failures[] }
 * `route` is a generation-flow step ('3a', '3c') or '4' (re-run the devnet).
 */
export function triage(report, name) {
  const sub = (xs) => xs.map((s) => s.replaceAll('__name__', name));
  const failures = report?.tests?.failures ?? [];
  const step = report?.failedStep ?? null;
  const base = { failedStep: step, failures, read: READ_ON_FAILURE };

  if (!report || report.crashed) {
    return {
      ...base,
      kind: 'infra',
      route: '4',
      cause: 'validate stopped without finishing its report (killed, or crashed)',
      actions: sub(['read logs/devnet.log', 'rerun: `yarn pipeline __name__ --retry-devnet`']),
      uiAffected: false,
    };
  }
  if (step === 'compile') {
    return {
      ...base,
      kind: 'reason',
      route: '3a',
      cause: 'the full compile (with proving keys) failed after compile:fast passed',
      actions: ['read the compiler output below; fix the contract (3a)'],
      uiAffected: true,
    };
  }
  if (step === 'env:up') {
    const tail = report.steps?.find((s) => s.step === step)?.outputTail ?? '';
    const port = /Bind for [\d.]+:(\d+) failed: port is already allocated/.exec(tail)?.[1];
    const held = port
      ? [`port ${port} is already in use: \`docker ps --filter publish=${port}\` shows which example's devnet holds it; run \`yarn env:down\` there`]
      : [];
    return {
      ...base,
      kind: 'infra',
      route: '4',
      cause: 'the devnet did not start: Docker is down, an image pull failed, or another example holds ports 6300/8088/9944',
      actions: sub([
        ...held,
        "`docker ps`: if another example's devnet is up, run `yarn env:down` in that example",
        'check that Docker is running and can pull images',
        'rerun: `yarn pipeline __name__ --retry-devnet`. No code change is needed',
      ]),
      uiAffected: false,
    };
  }
  if (step === 'wait:dust') {
    return {
      ...base,
      kind: 'infra',
      route: '4',
      cause: 'the genesis wallet had no spendable DUST in time',
      actions: sub([
        'rerun: `yarn pipeline __name__ --retry-devnet` (the network is still up, so this is quick)',
        'if it times out again, raise WAIT_FOR_DUST_TIMEOUT_MS and check logs/compose.log for node or indexer errors',
      ]),
      uiAffected: false,
    };
  }

  // test:local: the devnet suites run in order (sequence.concurrent: false)
  // and later tests build on earlier ones, so one root failure usually takes
  // the rest of the file with it. Classify by the first failure's message
  // only: test titles mention coins and tips whatever went wrong.
  const first = failures[0];
  const hay = first ? first.message ?? '' : report.steps?.find((s) => s.step === step)?.outputTail ?? '';
  const cls = TEST_CLASSES.find((c) => c.re.test(hay)) ?? FALLBACK;
  const at = first && new RegExp(`(${first.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+)`).exec(first.message)?.[1];
  const actions = sub(cls.actions);
  if (at) actions.unshift(`start at the first failure, ${at}`);
  if (failures.length > 1) {
    actions.push(`${failures.length - 1} later failure(s) probably follow from the first; re-run before fixing them one by one`);
  }
  return {
    ...base,
    kind: cls.kind,
    route: cls.route,
    class: cls.id,
    cause: cls.cause,
    actions,
    uiAffected: cls.uiAffected,
  };
}

/** The fix plan as Markdown, for .gates/devnet-fix.md. */
export function fixPlanMarkdown(plan, name, report) {
  const lines = [
    `# Devnet fix plan: ${name}`,
    '',
    `Failed at: \`${plan.failedStep ?? 'unknown'}\` (${plan.kind === 'infra' ? 'infrastructure, no code change' : `back to step ${plan.route}`})`,
    '',
    `**Likely cause:** ${plan.cause}.`,
    '',
    '## Do',
    '',
    ...plan.actions.map((a, i) => `${i + 1}. ${a}`),
    '',
    `**UI:** ${
      plan.uiAffected
        ? 'a fix in contract/ or witnesses.ts changes what the UI calls: re-run the pipeline afterwards, it re-runs the UI gates.'
        : 'a fix in src/test/ does not touch the UI; keep working on it.'
    }`,
    '',
  ];
  if (plan.failures.length) {
    lines.push('## Failing tests', '');
    for (const f of plan.failures) {
      lines.push(`- \`${f.file}\`${f.test ? ` › ${f.test}` : ''}`, '', '  ```', ...f.message.split('\n').map((l) => `  ${l}`), '  ```', '');
    }
  } else {
    const tail = report?.steps?.find((s) => s.step === plan.failedStep)?.outputTail;
    if (tail) lines.push('## Output (tail)', '', '```', tail, '```', '');
  }
  lines.push('## Read', '', ...plan.read.map((r) => `- ${r}`), '');
  return lines.join('\n');
}
