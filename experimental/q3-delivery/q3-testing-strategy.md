# Q3 2026 deliverables: testing strategy

> Mirrored for non-developers in Notion: [SOW3](https://app.notion.com/p/3ed4057b9f2381f49681d7f96458e796). The md is canonical: when you change owners, statuses, signers or open questions here, sync Notion as well (see [`AGENTS.md`](AGENTS.md)).

- **Status:** living draft. Expect to restructure it; we will get the architecture wrong the first time, so iterate.
- **Started:** 2026-09-30.
- **Scope:** the nine items in the Shielded Q3 2026 statement of work. For each one: how the Foundation verifies it independently, where that testing runs, and in what order.
- **Source of truth:** the delivery record in `midnight-network-ops`, at [`releases/deliverables/2026-q3/`][rec-dir] @ `a6e7daf`.
  - [`STL 2026-q3-deliverables.md`](STL%202026-q3-deliverables.md) in this folder is a byte-identical copy of [`2026-q3-deliverables.md`][rec].
  - The per-item folders (QA test evidence, examples, runbooks, demo transcripts) exist only in the canonical repo.
  - In citations below, `file:line` refers to that repo at that commit.

## How to extend this document

- Every deliverable has a section with a status block (`Status`, `Owner`, `Last updated`). Update the block when work moves.
- Cite the canonical file for any claim about a deliverable. Do not cite memory or a transcript paraphrase.
- Mark Compact and SDK identifiers as *per delivery record* until they have been compiled **and** run in our harness. This follows the repo's golden rule in [`AGENTS.md`](../../AGENTS.md): "Compilation alone is not proof — code must run."
- When a test exists, link it from its gap row. When a run happens, link its report JSON (see [P4](#p4-acceptance-report-format)).
- Put new findings about a deliverable, such as a defect or a doc inconsistency, under **Review findings** in that item's section. File the defects and doc errors at the servicedesk ([Reporting bugs and issues](#reporting-bugs-and-issues)), and link the ticket back from the finding.

## Testing posture

Two kinds of testing are in play. Keep them apart.

| | Vendor QA | Foundation acceptance (this plan) |
|---|---|---|
| Who | Shielded QA and the feature teams | Us, plus partners (see owner column) |
| Where | `midnightntwrk/compact-end-2-end` (`vp run cases:…`), `midnight-node/local-environment`, devnet | `mn-examples` (this repo), plus thin harnesses pointed at vendor environments |
| What it proves | The feature works as built, case by case | Each AC holds **independently**, **in DApp shape**, and **in the gaps QA left** |
| Evidence | `test-evidence/*-qa-test-evidence.md` per item | `reports/*.json` per run ([P4](#p4-acceptance-report-format)) |

The rules that follow from this:

1. **Gap-driven, not duplicative.** We do not re-run vendor QA as our own evidence. We run it once to check that it reproduces, then spend our effort on the gaps it states or leaves open.
2. **DApp shape.** Where a feature reaches DApp developers, we prove it the way they will use it: Midnight.js providers, wallet SDK, realistic contracts, and the `yarn new:example` layout.
3. **Three layers.**
   - **L1, in memory:** compact-runtime circuit execution with no proof. Fast, and runs in CI.
   - **L2, local network:** e2e through Midnight.js with proofs.
   - **L3, shared networks:** qanet, preview, preprod.
   - Vendor QA for 01, 02 and 03 runs only at L2 (proof + local-network tx) plus pre-circuit runtime rejections. Our L1 tests are new coverage.

## Testability tiers

| Tier | Meaning |
|---|---|
| **A**: easily tested here | A Compact/TS DApp feature. Fits the `examples/` harness once the stack is available. |
| **B**: testable, bespoke | Testable from the DApp layer, but needs a non-standard network, a fork procedure, or images built from source. |
| **C**: infrastructure prototype | Node or Cardano-side behaviour. Primary testing belongs to the infra team or partner. We contribute a DApp-layer probe at most. |
| **D**: not testable | MIP, design, or time-and-materials output. We verify the AC (where one exists) and review the text. |

## Triage

| ID | Deliverable | Tier | Where tested | Vendor QA | Our focus | Blocker | Owner / partner |
|---|---|---|---|---|---|---|---|
| [01](#sow-q3-01-crypto-schemes) | ed25519 + ECDSA P-256 in Compact | **A** | [`q3-ledger9/signature-verify`](../q3-ledger9/signature-verify/) | PASS, 63/63 tests | QA gaps, DApp-shape signature auth | none | nstanford5 ([roles](q3-test-ownership.md#sow-q3-01-crypto-schemes)) |
| [03](#sow-q3-03-dynamic-cross-contract-calls) | Dynamic cross-contract calls | **A** | [`q3-ledger9/dynamic-calls`](../q3-ledger9/dynamic-calls/) | PASS, 183/183 tests | `ContractModuleProvider` + error kinds | none | OpenZeppelin (contact TBD) + Jay Albert, Foundation ([roles](q3-test-ownership.md#sow-q3-03-dynamic-cross-contract-calls)) |
| [08](#sow-q3-08-hard-fork-v8-to-v9) | Hard fork ledger 8 → 9 | **B, highest value** | `midnight-node/local-environment` + our ledger 8 examples | PASS on local-env and devnet | Pre-fork DApps working post-fork | local-env bring-up | Leonard Hegarty, `hegaleon` ([roles](q3-test-ownership.md#sow-q3-08-hard-fork-v8-to-v9)) |
| [02](#sow-q3-02-recursive-proofs) | `verifyProof` / recursive proofs | **B** | compact-end-2-end harness, ledger 10 alpha | Demo cases + named negatives | Missing negative cases | **Blocked until Ledger 10 is released** | after Ledger 10 ([contributors](q3-test-ownership.md#sow-q3-02-recursive-proofs)) |
| [05](#sow-q3-05-babe-phase-1) | AURA → BABE migration | **C** | node team; we add a DApp liveness probe | Demo + runbook | DApp + indexer continuity across the flip | node 3.0.0 local-env | Ricardo Rius, `riusricardo` ([roles](q3-test-ownership.md#sow-q3-05-babe-phase-1)) |
| [06](#sow-q3-06-block-production-rewards) | Block production rewards | **C** (+ D for MIPs) | reserve-contracts `just private-net-*` | Demo | DUST-destination outcome, reward arithmetic | Custom Lace, TBD parameters | Karmoola, MPS-0019 ([roles](q3-test-ownership.md#sow-q3-06-block-production-rewards)) |
| [04](#sow-q3-04-private-state-mip) | Private state MIP | **D** | review | n/a | AC-1 = submitted | none | Karmoola, MPS-0021 ([roles](q3-test-ownership.md#sow-q3-04-private-state-mip)) |
| [07](#sow-q3-07-shielded-source-of-funds) | Shielded source of funds | **D** | review | n/a | Design review | none | Jalal-1, hbulgarini, MPS-0025 ([roles](q3-test-ownership.md#sow-q3-07-shielded-source-of-funds)) |
| [09](#sow-q3-09-throughput-performance) | Throughput performance | **D** | review + hash check | n/a | Report integrity, MIP review | none | BenB-MNF ([roles](q3-test-ownership.md#sow-q3-09-throughput-performance)) |

## Cross-cutting prerequisites

### P1 Artefact integrity

This is the lowest-hanging fruit: deterministic, no network to run, and it applies to every item.

- Script a check of every SHA-256 in [`2026-q3-deliverables.md`][rec] (the "Every artefact" block):
  - npm tarballs: `npm pack @midnight-ntwrk/<pkg>@<ver>` then `shasum -a 256 -c`.
  - GitHub release assets: download, then `shasum -a 256 -c`.
  - Container images: `docker buildx imagetools inspect <image:tag>` and compare against the listed digests (node, proof server, four indexer images).
  - SOW-09 PDF: `b53b19ee…da86`.
- Flag: the release bundle `2026-q3-release-1` is `draft`, its checksum table is still empty, and the record says final versions ship there. Re-run P1 against the bundle when it is published.
- Output: a report under `reports/` ([P4](#p4-acceptance-report-format)).

### P2 Ledger 9 workspace

**Decision (2026-09-30):** Q3 feature tests live in an **isolated workspace under `experimental/`**, with its own Yarn project and lockfile pinned to the record's Component versions table. The main `examples/` stay on the ledger 8 stack for two reasons:

- ledger 8 is what preprod runs today;
- those examples are the pre-fork DApps that [SOW-Q3-08](#sow-q3-08-hard-fork-v8-to-v9) needs.

A repo-wide bump waits until after the mainnet fork, as a coordinated pass (per `AGENTS.md`).

| Layer | mn-examples today (ledger 8) | Q3 workspace (ledger 9, from the record) |
|---|---|---|
| Compact compiler | 0.31.1 | 0.35.0 |
| Compact runtime | (via 0.31.1) | 0.20.0 |
| Midnight.js | 4.1.1 | 5.0.0-rc.1 (rc.2 needed for SOW-03 e2e) |
| Wallet SDK | 1.2.0 | 2.0.0-rc.0 |
| Ledger | `ledger-v8` 8.1.2 | 9.1.0.0-rc.5 |
| Node image | 1.0.0 | 2.1.0-rc.3 |
| Indexer image | 4.3.3 | 4.4.0-rc.6-068403cd |
| Proof server image | 8.1.0 | 9.0.0-rc.8 |

Implementation notes:

- Root workspaces are `examples/*`, `examples/*/ui` and `packages/*`, so `experimental/` is outside them. A nested Yarn project needs its own `yarn.lock`, so that Yarn 4 does not attach it to the root project.
- The compiler and the proof server must carry the same ZKIR (`zkir-3.1.0-rc.1`), per [`sow-q3-01…/examples/ed25519-demo.md:148`][01-ed].
- **Wrong image path in the record:** the record's "Indexer images" block gives `ghcr.io/midnight-ntwrk/<image>`, but ghcr refuses that path (401 anonymous, 403 authenticated), and the packages API has no such package under `midnight-ntwrk`. The images are **public** under `ghcr.io/midnightntwrk/` (no hyphen) and match the record's digests (`indexer-standalone` `sha256:5c717d83…`). Ask the release owners to correct the record. Docker Hub stops at `4.4.0-rc.2`.
- **Yarn age gate:** Yarn 4.18 quarantines packages younger than 24 hours by default, which catches same-day RCs. The workspace preapproves only `@midnight-ntwrk/*` and `@midnightntwrk/*`.
- Vendor QA for 01 ran with the on-chain runtime at **4.0.0-rc.3** (what the npm packages pin), not the rc.4 that is listed ([01 test evidence:5][01-te]). Record which one we run.

### P3 Ledger 10 workspace (SOW-02 only)

SOW-02 "cannot run on the ledger 9 stack" ([record:9][rec]). Every component is a ledger 10 alpha or a commit build, and no published images are listed. Reuse compact-end-2-end's `versions.qa.json` overlay, which builds node, indexer and proof-server images from source on first run, rather than maintaining our own. Keep it separate from P2.

### P4 Acceptance report format

Reuse the shape of [`reports/node-1.0.400-regression.json`](../../reports/node-1.0.400-regression.json):

- `subjectUnderTest`: component, version, build
- `run`: date, network, git commit, working-tree state, host, time window
- per-suite results

For each Q3 run, add `deliverable` (e.g. `SOW-Q3-01`), `acceptanceCriteria` (AC ids covered), and `gaps` (gap row ids below). Name files `reports/sow-q3-0N-<env>-<date>.json`.

### P5 Version-drift log

The vendor QA runs did not always use the pinned stack:

- SOW-03 ran on node 2.1.0-beta.1, proof-server 9.0.0-rc.7-arm64 and a compactc 0.34.101 branch build.
- SOW-08 ran on node 2.1.0-rc.2 and proof-server 9.0.0-rc.7.

Every acceptance report records its exact stack. Each item section notes where our pins differ from QA's.

## Reporting bugs and issues

Anyone testing this delivery opens a ticket at the **[Midnight servicedesk](https://github.com/midnightntwrk/servicedesk)** when they find a bug or an issue with a delivered feature. That includes Foundation testers, partners such as OpenZeppelin, and item owners. The servicedesk is the single entry point: triage routes the ticket to the delivering team, and it carries the SLA. Do not report defects only in ClickUp, a chat thread or this doc.

**Which template**

| What you found | Where it goes |
|---|---|
| A delivered feature behaves wrongly: a refusal that should not happen, an acceptance that should not, a crash, or a wrong result | [Bug report](https://github.com/midnightntwrk/servicedesk/issues/new?template=bug-report.yml) |
| An error or gap in the record, an example, a runbook or a migration guide (e.g. the wrong indexer image org, or `contractModuleProvider` missing from the Midnight.js migration guide) | [Documentation improvement](https://github.com/midnightntwrk/servicedesk/issues/new?template=documentation-improvement.yml) |
| A question that blocks testing (e.g. "where do `π` and `dist_fee` come from?") | [Help request](https://github.com/midnightntwrk/servicedesk/issues/new?template=help-request.yml) |
| **Anything with a security impact** (e.g. a signature accepted that should be refused, or a proof that verifies when it should not) | **[Private vulnerability report](https://github.com/midnightntwrk/servicedesk/security/advisories/new)**, never a public issue. Fallback: security@midnight.foundation |
| A comment on a MIP's design (04, 06, 07, 09) | The MIP pull request, not the servicedesk |
| A bug in our own harness (`q3-ledger9`, `examples/`) | Fix it here |

**What a ticket must contain.** The servicedesk's [AI reporting guidelines](https://github.com/midnightntwrk/servicedesk/blob/main/ai-reports.md) apply to every ticket, and to agent-assisted testing in particular. A ticket without a reproducing test is not triaged. Our harness already produces what they ask for:

- **Branch and commit SHA:** the mn-examples commit, the record commit (`a6e7daf`), and the exact stack (the `yarn stack:check` output, or the `subjectUnderTest` from the report JSON). These are pre-release versions, so name the RC and the image digest.
- **File paths and line references:** the test file and line, e.g. `experimental/q3-ledger9/signature-verify/src/…sim.test.ts:NN`, plus the contract source involved.
- **A runnable test case, in full:** the `it(…)` block that carries the gap id, and the command that runs it (`yarn test:sim` or `yarn test:local`).
- **Expected behaviour,** citing the record, spec or example line that says so, e.g. `[record:125]` or CoIP 4.
- **Actual behaviour,** with the logs, stack trace or error output.

**How to fill the form**

- **Title:** `[Bug]: SOW-Q3-0N <gap id>: <one-line summary>`, e.g. `[Bug]: SOW-Q3-03 03-G3: <what happened, on which input>`. The gap id ties the ticket to its test.
- **Component:** use the table below. Triage re-routes if the choice is wrong.
- **Network:** the form offers only Mainnet, Preprod, Preview or Not applicable. For local-env, devnet or qanet, pick *Not applicable* and name the environment in the first line of the description.
- **First seen where:** *Internal test / QA*.
- **Severity:** the form's P1–P4. Most findings on a local pre-release stack are P3 (degraded, workaround exists) or P2 (feature broken). Security findings skip the form; see above.
- **Label:** ask triage to add **`q3sow26`**, so that Q3 SOW tickets can be pulled together. This follows the `q2sow26` label used on last quarter's tickets (e.g. [#95](https://github.com/midnightntwrk/servicedesk/issues/95), [#97](https://github.com/midnightntwrk/servicedesk/issues/97)). The label exists (created 2026-10-02); see [all `q3sow26` tickets](https://github.com/midnightntwrk/servicedesk/issues?q=label%3Aq3sow26). Reporters can't set labels from the form, so ask in the ticket. If an agent helped find or write up the bug, say so in the ticket, as the guidelines ask; triage has a `bot:ai-assisted` label for this.

| SOW | Likely components (servicedesk form) |
|---|---|
| 01 | Contracts — Compact Compiler (compactc); Contracts — ZKIR; Contracts — Contract Runtime |
| 02 | Infra — ZK Circuits (midnight-zk); Contracts — Compact Compiler (compactc) |
| 03 | Contracts — Compact Compiler (compactc); Contracts — Contract Runtime; App/SDK — Midnight.js SDK (module provider) |
| 05 | Infra — Node (midnight-node); Infra — Indexer (midnight-indexer) |
| 06 | Infra — Node (midnight-node); Interop — Bridge Contracts; Interop — Partner Chains (Cardano) |
| 08 | Infra — Node; Infra — Ledger; Infra — Indexer; Infra — Proof Server; App/SDK — Wallet SDK; App/SDK — Midnight.js SDK |
| 04, 07, 09 | No running feature to report against. Design comments go on the MIP PR; errors in the delivered docs use the documentation template |

**After filing**

- Link the ticket from the finding under the item's **Review findings**, and from its gap row.
- Link it from the item's ClickUp task.
- Add it to the next report JSON for that item ([P4](#p4-acceptance-report-format)), so the sign-off shows what is still open.
- A ticket that is still open does not by itself block sign-off. The item owner decides, and records the decision with the sign-off.

**Not yet filed.** These findings in this doc are candidates. None has been filed yet:

| Finding | Item | Template |
|---|---|---|
| The indexer image path in the record names the wrong org (`midnight-ntwrk`, not `midnightntwrk`) | P2, all | documentation |
| CoIP 4 lists 10 failure kinds; compact-runtime 0.20.0 has 11 (`PureInterfaceCircuit`) | 03 | documentation |
| The Midnight.js v5.0.0-rc.2 migration guide does not mention `contractModuleProvider` | 03 | documentation |
| `secp256r1EcdsaVerify` throws an arithmetic error on `s = 0` rather than failing an assertion; behaviour when proven (L2) not yet checked | 01 | bug, once L2 confirms |
| Runbook ordering and gate-number inconsistencies | 05 | documentation |
| The AC puts staker payment out of scope, yet the demo pays delegators | 06 | help request, to the owner first |

---

## SOW-Q3-01 Crypto schemes

> **Status:** L1 green (50 tests), L2 green (6 tests), local network, record stack · **Owner:** nstanford5 ([roles](q3-test-ownership.md#sow-q3-01-crypto-schemes)) · **Last updated:** 2026-10-01 · **Tier A**
>
> **Report (preliminary, not for formal acceptance):** [Markdown](../q3-ledger9/reports/sow-q3-01-local-2026-10-01.md) · [JSON](../q3-ledger9/reports/sow-q3-01-local-2026-10-01.json)
>
> **Tests:** [`q3-ledger9/signature-verify`](../q3-ledger9/signature-verify/). The gap-to-test map and the observations are in [`q3-ledger9/README.md`](../q3-ledger9/README.md#coverage). Done: G1–G5 and G7–G11. Not done: G6 (Solana, optional).

**ACs** ([record:127-130][rec])
- AC-1: ed25519 signatures can be verified in Compact
- AC-2: ECDSA signatures over P256 can be verified in Compact

**Vendor QA** ([test evidence][01-te], compact-end-2-end @ `672bc50`, local network)
- Ed25519, 4 cases / 42 tests: RFC 8032 TEST 2 and SHA(abc); a Cardano mainnet signature; 25 edge cases (CCTV, Wycheproof, small/mixed order, s out of range); a torsion-point case.
- P-256, 4 cases / 21 tests: point ops; field arithmetic; RFC 6979 A.2.5 plus an `s+1` negative; a YubiKey registration signature plus a changed-origin negative.
- Layers: proof + local-network circuit calls, indexer reads, runtime rejections. There is no in-memory layer.

**Stdlib surface** (*per delivery record*, [ed25519-demo][01-ed], [secp256r1-demo][01-p2])
- `ed25519Verify<n>(msg, sig, pk): Boolean`: generic over the message length, so one circuit is needed per accepted length.
- `secp256r1EcdsaVerify(msgHash: Bytes<32>, sig: Secp256r1EcdsaSignature, pk: Secp256r1Point): Boolean`.
- A transcript says these are available "under `--feature-zkir-v3`". Check whether 0.35.0 still needs the flag.

**Gap tests**

| # | Test | +/− | Layer | Basis |
|---|---|---|---|---|
| 01-G1 | `secp256r1EcdsaVerify` with the identity point as the key is refused | − | L1, L2 | stated untested, [secp256r1-demo:39][01-p2] |
| 01-G2 | **Digest binding.** A contract that takes the digest as an argument accepts a digest of message B under a signature over message A. The in-circuit `persistentHash` contract does not. | −/+ | L1, L2 | security note, [record:125][rec] |
| 01-G3 | High-s **and** low-s forms both verify on the release stack. A contract-level low-s constraint rejects high-s. | +/− | L1, L2 | stated malleability, [secp256r1-demo:39][01-p2]; QA ran only high-s at `672bc50` |
| 01-G4 | P-256 negatives: wrong key, off-curve point, `r = 0`, `s = 0`, `r ≥ n`, `s ≥ n`, a secp256k1 signature presented as P-256 | − | L1, L2 | P-256 has 1 rejection test vs 14 for Ed25519 |
| 01-G5 | WebAuthn done properly: the challenge, type and origin in client data, plus rpIdHash and user-present in authenticator data, are checked in-circuit against a key stored in the ledger | +/− | L2 | stated as required and not done, [secp256r1-demo:125-129][01-p2] |
| 01-G6 | Solana-signed message verifies (Solana is named in the record; there is no vector) | + | L1, L2 | [record:120][rec] |
| 01-G7 | Message lengths: empty (RFC 8032 TEST 1), 1023-byte (TEST 1024), several `ed25519Verify<n>` in one contract | + | L1 | only 1, 32 and 64 covered |
| 01-G8 | `persistentHash<Bytes<N>>` equals SHA-256 from Node `crypto` | + | L1 | relied on, untested, [secp256r1-demo:37][01-p2] |
| 01-G9 | Signature and key supplied by a **witness** (private), not a circuit argument | + | L1, L2 | inference |
| 01-G10 | Replay: the same valid signature submitted twice; the contract must reject it if it is used as authorisation | − | L2 | inference |
| 01-G11 | Re-run on on-chain runtime 4.0.0-rc.4 | + | L2 | [test evidence:5][01-te] |

**DApp-shape example:** `signature-auth` in the P2 workspace. One contract with two actions:

- a Cardano-wallet-signed authorisation (Ed25519);
- a passkey-gated action (P-256) that checks the challenge in-circuit (01-G5).

It uses the `yarn new:example` layout and conventions, with fixtures captured once from real devices. Hardware signing cannot run in CI.

**Exit criteria:** G1–G8 and G11 green at L2 on the pinned stack. A report is filed. Any gap that fails is raised with the Compact team.

**Review findings:** the P-256 recording (`2fefc2b`) and the example (`672bc50`) differ in digest handling and s-form ([README:28][01-readme]). Make sure partner-facing docs show the in-circuit-digest form.

From the L1 run on 2026-10-01 (details in [`q3-ledger9/README.md`](../q3-ledger9/README.md#observations-and-findings)):
- Hostile P-256 inputs are refused in several different ways:
  - identity key: assertion;
  - off-curve key, or `r`/`s` ≥ n: type error;
  - `r = 0`: returns `false`;
  - `s = 0`: throws "secp256r1 scalar field has no inverse for 0". This is an arithmetic error, not an assertion, so check how it behaves when proven (L2).
- None is accepted.
- Raw `secp256r1EcdsaVerify` accepts both `(r, s)` and `(r, n-s)`. `Secp256r1Scalar` has no `<`, so a contract that needs low-s must split `s` into `Uint<128>` limbs and rebuild it through `Bytes<32>`. A stdlib helper or a doc note would save every passkey DApp this work.
- `ed25519Verify<0>` and `<1023>` work.
- A fixed-layout clientDataJSON rebuilt in-circuit makes the passkey challenge, origin, type, RP and UP checkable. Browsers that add or reorder keys would be refused, so the WebAuthn guidance needs a layout policy.

---

## SOW-Q3-03 Dynamic cross-contract calls

> **Status:** L1 green (16 tests), L2 green (6 tests), local network, Midnight.js 5.0.0-rc.2 · **Owner:** OpenZeppelin (contact TBD) + Jay Albert, Foundation ([roles](q3-test-ownership.md#sow-q3-03-dynamic-cross-contract-calls)) · **Last updated:** 2026-10-01 · **Tier A** (no longer gated)
>
> **Report (preliminary, not for formal acceptance):** [Markdown](../q3-ledger9/reports/sow-q3-03-local-2026-10-01.md) · [JSON](../q3-ledger9/reports/sow-q3-03-local-2026-10-01.json)
>
> **Tests:** [`q3-ledger9/dynamic-calls`](../q3-ledger9/dynamic-calls/). Done: AC-1, G1–G7, G9, G10, with 9 of the 11 failure kinds driven. Not done: G8 (stretch); `PureInterfaceCircuit` and `UnreadableModule`.

**AC** ([record:176][rec])
- AC-1: the same call site runs different callee code depending on the callee's contract **address**, not just its type.

**Vendor QA** ([test evidence][03-te], 17 cases / 183 tests)
- Covers: implementation binding across returns and ledger storage; missing or extra callee circuits; nested, diamond and circular calls; same-name circuits; references held in a ledger `Map`; witness and re-entrancy rejections; cost; shielded and unshielded value across a cross-contract call.
- Stack: branch and beta builds, not the record's Component versions.

**Blocker (resolved 2026-09-30):** the record says the module provider (midnight-js#1307) was unpublished ([record:171][rec]). Midnight.js `5.0.0-rc.2` and `@midnight-ntwrk/midnight-js-bundled-contract-module-provider@5.0.0-rc.2` were published on 2026-09-30, and the tests use them. Upstream compact-end-2-end main still pins rc.1, so its dynamic-call cases skip on a clean install.

**API surface** (*per delivery record*, [dynamic-module-resolution][03-dmr])
- Provider: `bundledContractModuleProvider` from `@midnight-ntwrk/midnight-js-bundled-contract-module-provider`, passed as `contractModuleProvider`.
- Errors: `ModuleResolutionError` from `@midnight-ntwrk/compact-runtime`. Check with `.is()`, not `instanceof`. It carries `failure.kind`; the record mentions "eleven" kinds but names only a few.
- `ModuleProviderAbsent` is raised when no provider is supplied.
- `createCircuitContext` takes a `CircuitContextOptions` object with an optional `crossContract` member.

**Gap tests**

| # | Test | +/− | Layer | Basis |
|---|---|---|---|---|
| 03-G1 | No provider → `ModuleProviderAbsent` | − | L1, L2 | [dmr:89][03-dmr]; no QA case drives a provider |
| 03-G2 | Address with no binding → `failure.kind === 'UnsupportedImplementation'` | − | L1, L2 | shown in the demo only |
| 03-G3 | Module bound to the wrong address (verifier keys differ) → `'ImplementationMismatch'` | − | L2 | [dmr:70, 97][03-dmr] |
| 03-G4 | Module missing a required circuit → `'NonconformantImplementation'` (QA covers the case, not the kind) | − | L1 | inference |
| 03-G5 | Enumerate all eleven `failure.kind` values from the runtime source and cover each one reachable from a DApp | − | L1 | [dmr:97][03-dmr] |
| 03-G6 | **Dynamic resolver:** a custom async `resolve(address)` backed by an off-chain registry. Lazy thunks; returning `undefined` vs throwing. | +/− | L1, L2 | record claims "fully dynamic, online lookup" ([record:166][rec]); only a static map is shown |
| 03-G7 | One call site, two implementations, **one transaction** (e.g. a DEX swap standard-token ↔ audited-token) | + | L2 | demo used separate txs |
| 03-G8 | Verifier-key change at an address invalidates an old mapping | − | L2 | inference |
| 03-G9 | In-memory cross-contract calls via `createCircuitContext({ crossContract })` | + | L1 | [dmr:108][03-dmr] |
| 03-G10 | Generated `.d.ts` carries `declaredInterfaces` / `circuitSignatures` | + | compile | [dmr:79][03-dmr] |
| 03-G11 | AC-1 re-run on the record's pinned stack (QA used beta builds) | + | L2 | P5 |

**DApp-shape example:** `token-registry`, modelled on the demo's DEX:

- one registry or DEX contract;
- two token implementations;
- a module map the app updates without redeploying the registry.

**Sequencing:** rc.2 is out, so both layers run on the published package.

**Exit criteria:** G1–G7 and G11 green at L2 on a published Midnight.js.

**Review findings** (from the L1 run on 2026-10-01; details in [`q3-ledger9/README.md`](../q3-ledger9/README.md#observations-and-findings)):
- **Spec drift:** CoIP 4 (@ca9da303) lists 10 failure kinds, but compact-runtime 0.20.0 has 11. `PureInterfaceCircuit` is missing from the spec.
- **Migration guide gap:** the Midnight.js v5.0.0-rc.2 migration guide does not mention `contractModuleProvider`. A DApp that made cross-contract calls before 0.35 fails with `ModuleProviderAbsent` and gets no pointer to the fix.
- **Online lookup:** `resolve()` is synchronous. The record's "fully dynamic, online lookup" works, but only by resolving ahead of time or deferring into the thunk, and the two report failures differently (`UnsupportedImplementation` vs `ModuleLoadRejected`). Document both patterns.
- **Stale upstream convention:** a caller compiles with no callee source beside it. compact-end-2-end's "callee managed dir named after the interface" convention predates 0.35.

---

## SOW-Q3-08 Hard fork v8 to v9

> **Status:** not started · **Owner:** Leonard Hegarty, `hegaleon` ([roles](q3-test-ownership.md#sow-q3-08-hard-fork-v8-to-v9)) · **Last updated:** 2026-10-01 · **Tier B, highest value for this repo**

**ACs** ([record:236-239][rec])
- AC-1: ledger state migrates; SDKs, wallets and DApp interfaces work without loss of state or breaking changes.
- AC-2: operational readiness for mainnet.

**Why this repo matters here.** The record claims "pre-fork DApps built with compactc 0.31.1 work after the fork without recompiling" ([record:230][rec]). Our `examples/` are exactly those DApps. The vendor QA gap matches what they cover:

- After the fork, only **two counter contracts** were driven through Midnight.js (row 15a).
- These are listed as not covered ([08 test evidence, "Not yet covered"][08-te]):
  - "The dApp checks after the fork for contract-held funds, Merkle proofs and multi-party state"
  - contract-to-contract calls
  - DUST re-registration at scale
  - indexer re-index from genesis
  - replay protection across the fork
  - a 24-hour soak

**What "without recompiling" means** ([walkthrough:237][08-wt]):

- The compiled 0.31.1 artefacts stay.
- The **client must move** to Midnight.js 5 / wallet SDK 2 / proof server 9.x, with the ZK config provider created with `verify: 'warn'`, because compactc 0.31.1 emits no `contract-manifest.json`.
- Midnight.js 4.1.1 and wallet SDK 1.2.0 cannot follow a forked chain:
  - "ledger-8-format transactions are rejected" ([walkthrough:236][08-wt]);
  - "stale ledger-8 prover refused" ([08 test evidence][08-te]).

**Fork rehearsal (local)**

| Phase | Action | Notes |
|---|---|---|
| 0 | Bring up `midnight-node/local-environment` at the 1.0.300 release (5 validators, spec 1000300, ledger 8.1.2), as in [walkthrough:51][08-wt]. Use indexer 4.4.0-rc.x **from genesis**. | Our compose (node 1.0.0, one node) has no documented fork path, and no Council/TC accounts were confirmed. Indexer 4.3.3 stops at the fork block. Proof server 8.1.0 is refused after the fork. |
| 1 | With the **current** repo (ledger 8 client), deploy every example and drive it into non-trivial state:<br>• multi-party (battleship, private-party)<br>• contract-held funds (shielded-chips, token-transfers)<br>• nested maps (zk-loan)<br>• commitments (private-bid, secret-message)<br>Persist the addresses, expected ledger state, wallet balances and private-state stores to a fixture. | Also save one signed-but-unsubmitted ledger 8 tx for phase 3. |
| 2 | Swap the validator binaries to 2.1.0, then run the governance upgrade:<br>• Council<br>• Technical Committee<br>• `federatedAuthority.motionClose`<br>• `system.applyAuthorizedUpgrade`<br>Follow [walkthrough][08-wt] and [governance-runtime-upgrade][08-gov]. | Manual through Polkadot.js the first time. Scripting it with `@polkadot/api` is a follow-up. Confirm spec 2001000 and `midnight_ledgerVersion` → `ledger-9.1.x`. |
| 3 | With a ledger 9 client (P2 workspace) and the **unrecompiled** 0.31.1 artefacts plus `verify: 'warn'`, join every contract and assert the checks below. | |

Phase 3 checks:

- ledger state equals the phase 1 fixture;
- every circuit is callable;
- NIGHT balances are unchanged;
- pre-fork shielded and unshielded UTxOs are spendable;
- DUST is 0, then re-registration works, including for a NIGHT-only wallet;
- the saved ledger 8 tx is refused with a typed error;
- the old prover is refused;
- private-state stores written by Midnight.js 4.1.1 are readable by 5.x (not addressed in any doc);
- fee estimation honours `min_block_price`;
- uncalled contracts show the midnight-indexer#1605 stale-encoding symptom, which is a known failure;
- midnight-wallet#415: re-registering already-registered NIGHT gives a generic error.

**Later environments:** qanet → preview → preprod ([record:16][rec], [08 test evidence, "Road to mainnet"][08-te]). Re-run phase 3 on each; preprod is the dress rehearsal. Wallets on those networks keep their state across the fork, so only the post-fork half applies there.

**Fast-sync impact:**
- The DUST reset and the indexer re-index make the `preseed/` bundles and wallet birthdays stale.
- Plan a `yarn preseed:cut` + `yarn wallets:new` after each shared-network fork.
- Re-check the Blockfrost indexer event-id offset at the same time.

**AC-2** cannot be tested from here. Review the runbook and governance guide, and observe or join the qanet and preprod drills.

**Exit criteria:** phase 3 green for every example on local-env; a report filed; findings raised. Then repeat on each shared network as SOW-08 reaches it.

---

## SOW-Q3-02 Recursive proofs

> **Status:** blocked until Ledger 10 is released · **Owner:** after Ledger 10 ([contributors](q3-test-ownership.md#sow-q3-02-recursive-proofs)) · **Last updated:** 2026-10-01 · **Tier B**

**ACs** ([record:157-158][rec])
- AC-1: a recursive proof can be created in midnight-zk.
- AC-2: a Compact contract can verify it.

**Vendor harness** ([verify-proof-demo][02-demo]): compact-end-2-end @ `baa813b`, Ledger 10 overlay, Docker + `cargo` + `vp`.

```bash
vp run cases:verify-proof
vp run cases:regression:qa -- single-valid,wrong-key,wrong-instance,corrupted-proof
vp run cases:regression:qa -- recursive-verify-proof
```

- **Inner proofs:** a Rust generator using midnight-zk crates writes a `.verifier` key and a proof bundle. The recursive chain is collapsed to one accumulator, which gives 12 public inputs.
- **Contract side** (*per delivery record*): `verifyProof(vkPath, proof, publicInputs)`. `vkPath` is a compile-time string literal. The proof arrives through a witness `Opaque<"Uint8Array">`.
- **Negatives shown:** wrong key, wrong instance, corrupted proof, tampered accumulator.

**Plan**
1. Reproduce the vendor run at `baa813b` as the baseline (AC-1 and AC-2). Record the build time and the SRS download.
2. Add the missing negatives, upstream in compact-end-2-end or in a P3 workspace:

| # | Test | Basis |
|---|---|---|
| 02-G1 | A valid proof against a **different genuine accumulator** | stated not covered, [verify-proof-demo:71][02-demo] |
| 02-G2 | A recursive vk wrongly tagged `None`. Document whether it is accepted unsoundly. | hazard described, untested, [verify-proof-demo:31][02-demo] |
| 02-G3 | A longer-chain collapsed proof against the **same** deployed vk | claimed in the collapsed transcript, not demonstrated |
| 02-G4 | Public-input count or order mismatch | inference |
| 02-G5 | The same proof replayed across two calls | inference |
| 02-G6 | Exact rejection messages asserted. Source them from upstream `src/cases/verify-proof/*.ts`; the docs don't quote them. | inference |
| 02-G7 | Explicit negative: a Compact contract's own proof is not verifiable (Poseidon vs Blake2b transcript) | stated limitation, [record:134][rec] |

3. DApp-shape (L2 with Midnight.js) waits until Ledger 10 is published and the P3 stack stops being commit builds.

---

## SOW-Q3-05 BABE phase 1

> **Status:** not started · **Owner:** Ricardo Rius, `riusricardo` ([roles](q3-test-ownership.md#sow-q3-05-babe-phase-1)) · **Last updated:** 2026-10-01 · **Tier C**

**AC** ([record:201][rec])
- AC-1: working prototype of BABE integrated into a branch of the Q2 release.

**Infrastructure:**
- midnight-node branch `demo-aura-to-babe-migration-q3` @ `efb3735`;
- the unreleased 3.0.0 runtime;
- polkadot-sdk `stable2609` RC;
- `local-environment` only.

**Procedure:** [aura-to-babe-migration-runbook][05-rb]:
- BABE keys, then the registration gate;
- v3 runtime upgrade;
- `consensusEngine.armBabe()` via Council → TC → `motionClose`;
- `scheduleFlip()`;
- automatic flip at the last slot of the epoch.

The rehearsal scripts are `npm run consensus-upgrade-arm-babe:local-env` and `npm run consensus-upgrade-schedule-flip:local-env`.

**Gap this repo can fill:** neither recording shows DApp transactions or the indexer across the switch. Indexer ingestion is only a runbook checkbox.

| # | Test | Notes |
|---|---|---|
| 05-G1 | **DApp liveness probe:** a deploy + call loop, wallet sync and indexer subscription, running continuously through binary rollout → runtime upgrade → `ArmedBabe` → `ScheduledFlip` → flip block. Assert every tx finalises, no indexer gap at the flip block, wallet sync survives, and contract reads stay consistent. | Needs `local-environment` to ship an indexer and proof server compatible with node 3.0.0. Unconfirmed. |
| 05-G2 | Scripted state assertions over RPC: `consensusEngine.engineState`, `babe.authorities`, header pre-digests and seal, finality advancing across the boundary | The runbook says there is no RPC exposing all four states, so read storage |
| 05-G3 | Armed vs unarmed variants (`b84629e` vs `b4b4fcb`), both run with the probe | |

**Review findings** (raise with the node team):
- The runbook's phase ordering is inconsistent across three places ([runbook:306-307, 320][05-rb], Phase 1.1).
- Gate numbers are mis-referenced ([runbook:102, 148, 153][05-rb]).
- "No node restarts" ([runbook:6][05-rb]) contradicts the binary rollout.
- "There is no rollback extrinsic": recovery is an emergency governance upgrade.

---

## SOW-Q3-06 Block production rewards

> **Status:** not started · **Owner:** Karmoola, MPS-0019 ([roles](q3-test-ownership.md#sow-q3-06-block-production-rewards)) · **Last updated:** 2026-10-01 · **Tier C**, MIP part **D**

**AC** ([record:218][rec])
- AC-1: a working prototype and a MIP for rewards in NIGHT to validators. Payment to Ada stakers is out of scope.

**Infrastructure** ([rewards-overview, Local demo][06-ov]):
- midnight-node `block-rewards-demo` @ `d7c4404`;
- midnight-reserve-contracts `block-rewards-validators` @ `bb2a358`;
- a Cardano devnet + db-sync + 6 Midnight nodes;
- `just private-net-up | -deploy | -pump | -explorer | -down`;
- a custom Lace build for register, withdraw and edit.

**Plan**
- Reproduce the demo with the `just` recipes. Script the observable checks:
  - the `blockRewards` storage and inherent digest `(epoch, root, min_key, max_key, treasury_total)` on Midnight;
  - payout transactions through db-sync on Cardano.
- 06-G1: check that a registered DUST destination actually produces DUST on Midnight. That end is never shown.
- 06-G2: reward arithmetic (fixed + utilisation share, Treasury remainder, pro-rata split). This is blocked while `π` and `dist_fee` are TBD ([rewards-overview:103, 107][06-ov]).
- Not testable yet: exits ("the demo does not deregister") and digest sharding.
- MIPs [#321][mip-321] and [#262][mip-262]: review only.

**Review findings:** the AC puts "Payment to Ada stakers" out of scope, yet the overview and demo pay `pool1` delegators through Lace ([rewards-overview:13, 152][06-ov]). Clarify which one is intended.

---

## SOW-Q3-04 Private state MIP

> **Status:** not started · **Owner:** Karmoola, MPS-0021 ([roles](q3-test-ownership.md#sow-q3-04-private-state-mip)) · **Last updated:** 2026-10-01 · **Tier D**

- AC-1 "Completed MIP submitted to the MIP process": check it against [MIP PR #334][mip-334] (text @ `49bbfd7`). This is a fact check, not a test.
- Run the [MIP review checklist](#mip-and-design-review-checklist).
- Later: turn the MIP's normative statements into acceptance-test stubs, so the implementation (delivered over later quarters) arrives with ready-made tests.

## SOW-Q3-07 Shielded source of funds

> **Status:** not started · **Owner:** Jalal-1, hbulgarini, MPS-0025 ([roles](q3-test-ownership.md#sow-q3-07-shielded-source-of-funds)) · **Last updated:** 2026-10-01 · **Tier D** (time and materials, no ACs)

- Design review of [MIP PR #335][mip-335] @ `41d3b15` against [MPS-0025][mps-25], using the checklist.
- Optional, out of scope for Q3: a Compact "token guard" spike to test whether the custom-spend-logic design can be expressed on today's stack.

## SOW-Q3-09 Throughput performance

> **Status:** not started · **Owner:** BenB-MNF ([roles](q3-test-ownership.md#sow-q3-09-throughput-performance)) · **Last updated:** 2026-10-01 · **Tier D** (time and materials, no ACs)

- Verify the report PDF SHA-256 `b53b19ee83817dcd603f7395ac26a4e38aaf055bad9bbd886b37cd91bd67da86` (P1).
- Review [MIP #312][mip-312] (revalidation cache) and [MIP #309][mip-309] (interim ledger state).
- Optional: our examples could supply a realistic DApp transaction mix for future load tests, instead of synthetic transfers.

## MIP and design review checklist

Use for 04, 06 (MIPs), 07 and 09.

- [ ] Responds to its MPS: every problem-statement requirement is addressed or explicitly deferred.
- [ ] Normative statements (MUST/SHOULD) are separated from informative text.
- [ ] Parameters are stated, or listed as open with an owner (e.g. `π`, `dist_fee` in 06).
- [ ] Security and privacy considerations are present; failure and adversary cases are named.
- [ ] Backwards compatibility and migration are covered (contracts, wallets, indexer, SDKs).
- [ ] **Testability:** each normative statement can become an acceptance test. List the ones that cannot.
- [ ] Open questions are tracked, with where they will be resolved.

---

## Order of work

1. **P1 artefact checksums.** Deterministic; no network needed.
2. **P2 ledger 9 workspace + SOW-01:** workspace built ([`q3-ledger9`](../q3-ledger9/)); L1 and L2 green (2026-10-01).
3. **SOW-08 fork rehearsal** on `local-environment`, using our ledger 8 examples.
4. **SOW-03:** L1 and L2 green on Midnight.js `5.0.0-rc.2` (see [`q3-ledger9`](../q3-ledger9/)).
5. **Review passes:** 04, 06 MIPs, 07, 09, and the 05 runbook findings.
6. **SOW-02** baseline reproduction, then negatives on ledger 10. Blocked until Ledger 10 is released.
7. **SOW-05** DApp liveness probe, when a node 3.0.0 local-env with indexer and proof server is available.
8. **SOW-06** checks, once `π` and `dist_fee` are set.

## Open questions

- **Owners and partners:** who tests and who signs off each item is mapped in [`q3-test-ownership.md`](q3-test-ownership.md), starting from the MIP and deliverable authors. The independent testers are still open there.
- **Foundation owners still to name** (details in [`q3-test-ownership.md` Open questions](q3-test-ownership.md#open-questions)):
  - SOW-02: the owner is named when Ledger 10 is released.
  - SOW-03: OpenZeppelin and the Foundation sign together. Jay Albert signs for the Foundation; the OpenZeppelin contact is still TBD.
- **Network access:** access to qanet for SOW-08; who schedules our phase 3 runs against each fork.
- **Upstream contributions:** should the pure stdlib-level gap tests (01-G1/G3/G4/G7, 02-G1–G6) be contributed to compact-end-2-end instead of, or as well as, living here?
- **Custom Lace:** can we get the build (`MicroProofs/lace@3fc3166`) for SOW-06, and is a wallet-free CLI path enough?
- ~~**Tracking surface**~~ **Decided 2026-10-01: ClickUp.** The open questions and assignments are tracked there. Defects go to the servicedesk instead (see [Reporting bugs and issues](#reporting-bugs-and-issues)).
- **On-chain runtime rc.4:** do we ask vendor QA to re-run SOW-01 on the rc.4 it lists, or is our 01-G11 enough?

[rec-dir]: https://github.com/midnightntwrk/midnight-network-ops/tree/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3
[rec]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/2026-q3-deliverables.md
[01-readme]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-01-crypto-schemes/README.md
[01-te]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-01-crypto-schemes/test-evidence/sow-q3-01-crypto-schemes-qa-test-evidence.md
[01-ed]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-01-crypto-schemes/examples/ed25519-demo.md
[01-p2]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-01-crypto-schemes/examples/secp256r1-demo.md
[02-demo]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-02-recursive-proofs/examples/verify-proof-demo.md
[03-te]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-03-multi-contract-systems-2/test-evidence/sow-q3-03-multi-contract-systems-2-qa-test-evidence.md
[03-dmr]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-03-multi-contract-systems-2/examples/dynamic-module-resolution.md
[05-rb]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-05-babe-phase-1/examples/aura-to-babe-migration-runbook.md
[06-ov]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-06-block-production-rewards/examples/rewards-overview.md
[08-te]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-08-hard-fork-v8-v9/test-evidence/sow-q3-08-hard-fork-v8-v9-qa-test-evidence.md
[08-wt]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-08-hard-fork-v8-v9/examples/hard-fork-migration-demo-walkthrough.md
[08-gov]: https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/sow-q3-08-hard-fork-v8-v9/examples/governance-runtime-upgrade.md
[mip-334]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/334
[mip-335]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/335
[mip-321]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/321
[mip-262]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262
[mip-312]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/312
[mip-309]: https://github.com/midnightntwrk/midnight-improvement-proposals/pull/309
[mps-25]: https://github.com/midnightntwrk/midnight-improvement-proposals/blob/5d881268081842bdd3b52bf6b4509c937de95c22/mps/mps-0025-shielded-source-of-funds.md
