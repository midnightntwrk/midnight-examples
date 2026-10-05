// yarn report:md — renders each reports/sow-q3-0N-local-<date>.json as a
// Markdown report next to it, for sharing outside the repo (e.g. the Q3 SOW
// project). Numbers, test results and the stack come from the JSON; the
// preliminary notice, gap definitions and findings are curated below.
//
// Keep the notice. These runs are preliminary engineering checks, not formal
// acceptance evidence.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const REPORTS = path.join(ROOT, 'reports');

interface Test { file: string; name: string; status: string; durationMs: number; covers: string[]; failure?: string }
interface Suite { layer: string; exitCode: number | null; passed: number; failed: number; tests: Test[] }
interface Report {
  deliverable: string;
  title: string;
  acceptanceCriteria: Record<string, string>;
  run: { startedAt: string; finishedAt: string; network: string; gitCommit: string; gitBranch: string; workingTree: string; host: string };
  stack: {
    packages: Array<{ name: string; expected: string; resolved: string; local: boolean }>;
    compiler: string;
    images: Record<string, string>;
  };
  suites: Suite[];
}

interface Curated {
  folder: string;
  vendorQa: string;
  gaps: Record<string, string>;
  notCovered: string[];
  findings: string[];
}

const CURATED: Record<string, Curated> = {
  'SOW-Q3-01': {
    folder: 'signature-verify',
    vendorQa:
      'Shielded QA suite PASS on 2026-09-30: Ed25519 4/4 cases, 42/42 tests; ECDSA P-256 4/4 cases, 21/21 tests (compact-end-2-end@672bc50, local network). These tests do not repeat that suite. They target the gaps it leaves open and use the features in DApp shape.',
    gaps: {
      'AC-1': 'ed25519 signatures can be verified in Compact',
      'AC-2': 'ECDSA signatures over P256 can be verified in Compact',
      '01-G1': 'identity P-256 public key is refused',
      '01-G2': 'unbound-digest anti-pattern demonstrated; in-circuit digest refuses it',
      '01-G3': 'P-256 malleability: raw verify accepts (r, s) and (r, n-s); a contract-level low-s rule works',
      '01-G4': 'hostile P-256 keys and scalars are never accepted',
      '01-G5': 'passkey/WebAuthn assertion checked in-circuit for challenge, origin, type, RP and user presence',
      '01-G7': 'Ed25519 message lengths 0 and 1023 bytes',
      '01-G8': 'persistentHash<Bytes<N>> equals SHA-256',
      '01-G9': 'signature and key supplied privately (witness), bound to a public commitment',
      '01-G10': 'one-time authorisation: replay refused',
    },
    notCovered: [
      '01-G6: a Solana-signed vector (optional; Ed25519 is the same algorithm).',
      '01-G11 is shown by the stack table, not by a test: the run used onchain-runtime 4.0.0-rc.4 as the record lists, where vendor QA used rc.3.',
      'P-256 `s = 0` was only tried in memory, where it throws an arithmetic error ("no inverse for 0") rather than failing an assertion. How it behaves when proven on chain is untested.',
      'The real-device YubiKey vector was only checked in memory. On-chain passkey tests use a software P-256 key in the same WebAuthn byte layout.',
    ],
    findings: [
      'How a hostile P-256 input is refused depends on the input. Identity key: failed assertion. Off-curve key, or `r`/`s` ≥ n: type error before the circuit runs. `r = 0`: returns `false`. `s = 0`: throws an arithmetic error. None is accepted.',
      'Ed25519 hostile inputs are all refused. Identity key: failed assertion. Off-curve key, small-order key and non-canonical `s + L`: refused before the circuit runs.',
      '`secp256r1EcdsaVerify` has no low-s rule, and `Secp256r1Scalar` supports no `<`. A contract can still enforce low-s by taking `s` as two `Uint<128>` limbs and rebuilding the scalar through `Bytes<32>`. A stdlib helper or a doc note would spare every passkey DApp this.',
      'Rebuilding the WebAuthn clientDataJSON in-circuit from constants and the stored challenge makes the challenge, origin, type, RP and UP checkable. Browsers that add or reorder JSON keys would be refused, so production guidance needs a layout policy.',
      'compactc 0.35.0 still needs `--feature-zkir-v3` for these circuits; ZKIR v2 is the default.',
    ],
  },
  'SOW-Q3-03': {
    folder: 'dynamic-calls',
    vendorQa:
      'Shielded QA suite PASS on 2026-09-28: 17/17 cases, 183/183 tests. That run used branch and beta builds: compactc 0.34.101 @ b3bda7d and Midnight.js 5.0.0-beta.8. compact-end-2-end main pins Midnight.js 5.0.0-rc.1, so its dynamic-call cases skip on a clean install. This is the first run we know of against the published `@midnight-ntwrk/midnight-js-bundled-contract-module-provider@5.0.0-rc.2`.',
    gaps: {
      'AC-1': "the same call site runs the code deployed at the callee's address, not one implementation per type",
      '03-G1': 'no module provider: `ModuleProviderAbsent`',
      '03-G2': 'address with no binding: `UnsupportedImplementation`',
      '03-G3': 'module bound to the wrong address: `ImplementationMismatch`',
      '03-G4': 'module missing the declared circuit: `NonconformantImplementation`',
      '03-G5': 'the other failure kinds: `ProviderThrew`, `ModuleLoadRejected`, `IncompleteModule`, `MalformedVerifierKeyHash`, `OperationAbsent`',
      '03-G6': 'dynamic resolution: implementation found from on-chain verifier keys; lookup deferred into the module thunk',
      '03-G7': 'two implementations in one transaction (swap)',
      '03-G10': 'generated modules carry `declaredInterfaces` / `circuitSignatures` / `expectedVk`',
    },
    notCovered: [
      '03-G8: a verifier-key change at an address (contract maintenance) after which an old mapping fails (stretch goal).',
      '`PureInterfaceCircuit` and `UnreadableModule`, 2 of the runtime\'s 11 `ModuleResolutionError` kinds, are not driven.',
      '`NonconformantImplementation` and the five 03-G5 kinds were only tested in memory, where the runtime runs the same checks it runs before submitting to a network.',
    ],
    findings: [
      'CoIP 4 (@ca9da303) lists 10 failure kinds, but compact-runtime 0.20.0 has 11. `PureInterfaceCircuit` is missing from the spec.',
      'The Midnight.js v5.0.0-rc.2 migration guide does not mention `contractModuleProvider`. A DApp that made cross-contract calls before 0.35 fails with `ModuleProviderAbsent` and gets no pointer to the fix.',
      '`ContractModuleProvider.resolve` is synchronous. The record\'s "fully dynamic, online lookup" works, but only by resolving ahead of time or deferring into the thunk, and the two report failures differently (`UnsupportedImplementation` vs `ModuleLoadRejected`).',
      "A calling contract compiles with no callee source beside it; only its `contract Token { … }` declaration is needed. compact-end-2-end's \"callee managed dir named after the interface\" convention predates 0.35.",
      'The in-memory simulator can run cross-contract calls when the callee states carry the compiled verifier keys. That gives a fast test layer no network can match.',
    ],
  },
};

const COMMON_FINDINGS = [
  "The record gives the indexer images as `ghcr.io/midnight-ntwrk/…`. ghcr refuses that path (401 anonymous, 403 authenticated). The same images are public at `ghcr.io/midnightntwrk/…` (no hyphen), and their digests match the record.",
  'Indexer 4.4.0-rc.6 exits ("block number 1 not found") if started before the node produces block 1. The local compose file waits for block 1.',
  "Yarn 4.18's default 24-hour minimum package age quarantines same-day release candidates. The test workspace exempts only the first-party Midnight scopes.",
];

const NOTICE = `> [!WARNING]
> **Preliminary. Not for formal acceptance.**
>
> These are early engineering tests by the Midnight Foundation, run on a single local
> development network (\`undeployed\`) against release-candidate components. They have
> not been reviewed, run on a shared network (qanet, preview, preprod), or repeated on
> a released stack. The code that produced them was not yet committed when they ran.
>
> Do **not** use this report as evidence to accept or reject this deliverable. The
> delivering team's QA evidence and the Foundation's formal acceptance process remain
> the basis for that decision. Treat the findings below as questions to raise, not
> verdicts.`;

const esc = (s: string) => s.replace(/\|/g, '\\|');
const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function render(r: Report): string {
  const c = CURATED[r.deliverable];
  if (!c) throw new Error(`no curated content for ${r.deliverable}`);
  const allTests = r.suites.flatMap((s) => s.tests.map((t) => ({ ...t, layer: s.layer })));
  const total = (layer: string) => r.suites.find((s) => s.layer === layer);
  const date = r.run.startedAt.slice(0, 10);
  const L: string[] = [];

  L.push(`# ${r.deliverable} preliminary test report (${date})`, '');
  L.push(NOTICE, '');
  L.push(`**Deliverable:** ${r.deliverable} ${r.title}  `);
  L.push(`**Run:** ${r.run.startedAt} to ${r.run.finishedAt}, ${r.run.network}, ${r.run.host}  `);
  L.push(
    `**Source:** \`experimental/q3-ledger9/${c.folder}\` in mn-examples, branch \`${r.run.gitBranch}\` @ \`${r.run.gitCommit}\`, working tree **${r.run.workingTree}** (test code not yet committed)  `,
  );
  L.push('**Plan:** the Foundation\'s SOW3 testing strategy (internal)', '');

  L.push('## Result', '');
  L.push('| Layer | What it is | Passed | Failed |', '|---|---|---|---|');
  const desc: Record<string, string> = {
    sim: 'L1, in memory: compact-runtime execution, no network, no proofs',
    e2e: 'L2, local network: deploy and call through Midnight.js with real proofs',
  };
  for (const s of r.suites) L.push(`| ${s.layer} | ${desc[s.layer] ?? s.layer} | ${s.passed} | ${s.failed} |`);
  L.push('');

  L.push('## Acceptance criteria (from the delivery record)', '');
  for (const [id, text] of Object.entries(r.acceptanceCriteria)) L.push(`- **${id}:** ${text}`);
  L.push('');
  L.push('## Vendor QA, for context', '', c.vendorQa, '');

  L.push('## Coverage', '');
  L.push('Gap ids are defined in the strategy doc. "In memory" and "Network" count the tests that name the id.', '');
  L.push('| Id | What is checked | In memory | Network |', '|---|---|---|---|');
  for (const [id, text] of Object.entries(c.gaps)) {
    const count = (layer: string) => allTests.filter((t) => t.layer === layer && t.covers.includes(id)).length;
    const sim = count('sim');
    const e2e = count('e2e');
    L.push(`| ${id} | ${esc(text)} | ${sim || '—'} | ${e2e || '—'} |`);
  }
  L.push('', '**Not covered by this run:**', '');
  for (const n of c.notCovered) L.push(`- ${n}`);
  L.push('');

  L.push('## Findings to raise', '');
  L.push('These are behaviour we observed; none of it was assumed in advance. They are prompts for discussion with the delivering team.', '');
  [...c.findings, ...COMMON_FINDINGS].forEach((f, i) => L.push(`${i + 1}. ${f}`));
  L.push('');

  L.push('## Stack used', '');
  L.push(`Compact compiler: \`${r.stack.compiler}\``, '');
  L.push('| Package | Resolved | Expected | From this workspace |', '|---|---|---|---|');
  for (const p of r.stack.packages)
    L.push(`| \`${p.name}\` | ${p.resolved} | ${p.expected} | ${p.local ? 'yes' : '**no**'} |`);
  L.push('', '| Image | Digest |', '|---|---|');
  for (const [image, digest] of Object.entries(r.stack.images)) L.push(`| \`${image}\` | \`${digest.split('@')[1] ?? digest}\` |`);
  L.push(
    '',
    "Deviations from the record's Component versions: Midnight.js and testkit-js are `5.0.0-rc.2` (the record lists rc.1); rc.2 is the first release with the cross-contract module provider. The indexer image path uses the corrected `midnightntwrk` org. All three image digests match the record.",
    '',
  );

  L.push('## Test results', '');
  for (const s of r.suites) {
    L.push(`### ${s.layer} (${desc[s.layer] ?? s.layer})`, '');
    L.push('| Status | Test | Covers | Time |', '|---|---|---|---|');
    for (const t of s.tests) {
      const mark = t.status === 'passed' ? 'pass' : `**${t.status}**`;
      L.push(`| ${mark} | ${esc(t.name)} | ${t.covers.join(', ') || '—'} | ${secs(t.durationMs)} |`);
    }
    const failed = s.tests.filter((t) => t.failure);
    if (failed.length) {
      L.push('', 'Failures:', '');
      for (const t of failed) L.push(`- ${esc(t.name)}: \`${esc(t.failure!)}\``);
    }
    L.push('');
  }

  L.push('## Reproduce', '');
  L.push('```bash');
  L.push('cd experimental/q3-ledger9');
  L.push('compact update --no-set-default 0.35.0');
  L.push('yarn install && yarn stack:check && yarn compile');
  L.push('yarn env:up && yarn wait:dust');
  L.push('yarn report        # writes the JSON and this Markdown');
  L.push('yarn env:down');
  L.push('```', '');
  L.push(`Machine-readable version: \`${r.deliverable.toLowerCase()}-local-${date}.json\` (same folder).`, '');
  return L.join('\n');
}

const files = readdirSync(REPORTS).filter((f) => /^sow-q3-\d\d-local-.*\.json$/.test(f));
for (const f of files) {
  const report = JSON.parse(readFileSync(path.join(REPORTS, f), 'utf8')) as Report;
  const out = path.join(REPORTS, f.replace(/\.json$/, '.md'));
  writeFileSync(out, render(report));
  console.log(`wrote ${path.relative(ROOT, out)}`);
}
