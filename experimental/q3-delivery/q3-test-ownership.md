# Q3 2026 deliverables: who tests and signs off

> Mirrored for non-developers in Notion: [SOW3](https://app.notion.com/p/3ed4057b9f2381f49681d7f96458e796). The md is canonical: when you change owners, statuses, signers or open questions here, sync Notion as well (see [`AGENTS.md`](AGENTS.md)).

- **Status:** living draft. Expect to restructure it as owners and partners are confirmed.
- **Started:** 2026-10-01.
- **Scope:** the seven items in [`q3-testing-strategy.md`](q3-testing-strategy.md) that have no Foundation test run yet (02, 04, 05, 06, 07, 08 and 09), plus SOW-01 and SOW-03, which already have Foundation runs ([`q3-ledger9`](../q3-ledger9/)) but need their owners and sign-off recorded.
- **Starting point:** the people who wrote each MIP or built each deliverable. They are required parties to that item's testing and sign-off. Every other role is assigned around them.

## How to extend this document

- Every name links to its evidence: a PR, a front-matter `Authors:` line, or a branch compare. Do not add a name from memory.
- An affiliation is either *confirmed* by the Foundation or *inferred* from a hard signal, and each one says which, and from what. Leave an affiliation blank rather than guess.
- When you assign a role, replace its `TBD` and update the item's status block in the strategy doc.
- Refresh the contributor lists with the commands in [How this was gathered](#how-this-was-gathered) before a sign-off round.

## Roles

| Role | Who | Required to | Must not |
|---|---|---|---|
| **R1 Author / builder** | Wrote the MIP, or the code under test | Be consulted on the test design. Co-sign that the tests exercise what was designed. | Run Foundation acceptance or give it for their own item |
| **R2 Owner / requirement owner** | Wrote the MPS the MIP answers. For an item with no MPS, the owner named by the Foundation. | Sign off that the deliverable answers the problem statement or AC. This is the Foundation acceptor. | Be an R1 on the same item |
| **R3 Independent tester** | Runs the gap tests in the strategy doc | Produce the report JSON ([P4](q3-testing-strategy.md#p4-acceptance-report-format)) | Be an R1 on the same item |
| **R4 Process gate** | `@midnightntwrk/mn-codeowners-improvement-proposals`, the `*` owner in the MIP repo's `CODEOWNERS` | Approve MIP-process ACs, such as 04 "submitted to the MIP process" | Approve their own MIP |

"Sign-off" here means a named person approves a specific artefact (the gap-test list, or the report JSON for a run), on a date. The owner's formal acceptance is recorded in the [Sign-off record](#sign-off-record). Later, the [P4](q3-testing-strategy.md#p4-acceptance-report-format) report shape could carry it as `signOff: [{ role, github, date, artefact }]`. The report writer does not do that yet.

## Summary

| SOW | Deliverable | R1 authors / builders | R2 owner | R3 tester | State |
|---|---|---|---|---|---|
| [01](#sow-q3-01-crypto-schemes) | Crypto schemes | iquerejeta | **nstanford5** | Foundation run, done | L1 and L2 green; report waiting for sign-off |
| [02](#sow-q3-02-recursive-proofs) | Recursive proofs | dybvig, whankinsiv, miguel-ambrona, iquerejeta | after Ledger 10 | after Ledger 10 | **blocked: Ledger 10** |
| [03](#sow-q3-03-dynamic-cross-contract-calls) | Dynamic cross-contract calls | JosephDenman, jonathan-sobel, kmillikin | **OpenZeppelin** (contact TBD) + **Jay Albert** (Foundation co-signer) | Foundation run, done | L1 and L2 green; report waiting for sign-off |
| [04](#sow-q3-04-private-state-mip) | Private state MIP | kapke, jonathan-sobel | Karmoola (MPS-0021) | TBD | ready for review |
| [05](#sow-q3-05-babe-phase-1) | BABE phase 1 | Klapeyron, LGLO | **Ricardo Rius** (`riusricardo`) | TBD | owner named |
| [06](#sow-q3-06-block-production-rewards) | Block production rewards | MicroProofs, luminight99, LGLO | Karmoola (MPS-0019, MPS-0033) | TBD | 06-G2 blocked on `π`, `dist_fee` |
| [07](#sow-q3-07-shielded-source-of-funds) | Shielded source of funds | kapke | Jalal-1, hbulgarini (MPS-0025) | TBD | ready for review |
| [08](#sow-q3-08-hard-fork-v8-to-v9) | Hard fork v8 → v9 | ozgb, jacek-kurkowski-shielded, mhounslow, GiuseppeSalvatoreShielded, gilescope | **Leonard Hegarty** (`hegaleon`) | TBD | owner named |
| [09](#sow-q3-09-throughput-performance) | Throughput performance | dzajkowski, chrispalaskas | **BenB-MNF** | TBD | owner named |

---

## SOW-Q3-01 Crypto schemes

> **Status:** L1 and L2 green on 2026-10-01 (preliminary report, not yet signed) · **Owner:** nstanford5 · **Last updated:** 2026-10-01

This item already has a Foundation run in [`q3-ledger9/signature-verify`](../q3-ledger9/signature-verify/), with a [preliminary report](../q3-ledger9/reports/sow-q3-01-local-2026-10-01.md). It is here so that its owner and sign-off are recorded.

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | iquerejeta | author of [compact#793](https://github.com/LFDT-Minokawa/compact/pull/793) "Add ECDSA over P256 and Ed25519" (merged 2026-09-28), the only commit author on it | AC-1, AC-2; co-signs the gap list 01-G1…G11; answers the P-256 review findings (the `s = 0` arithmetic error, no low-s helper, WebAuthn layout policy) |
| R2 | **nstanford5** (Nick Stanford) | named by the Foundation, 2026-10-01. Not an author of compact#793, so no conflict. | AC-1 and AC-2 acceptance; signs the report |
| R3 | Foundation run (`q3-ledger9`), done for L1 and L2 | committed by Nick Stanford; [report JSON](../q3-ledger9/reports/sow-q3-01-local-2026-10-01.json) | AC-1, AC-2, 01-G1…G5, G7…G11. Not done: G6 (Solana, optional) |

The same person both ran the tests and signs them off. The role rules allow this; they only bar authors. It is recorded here so the sign-off states it.

Sign-off artefacts:
- R1 co-signs that the gap tests exercise the two verify circuits as designed.
- R2 signs the report JSON. Until then the report stays preliminary.

---

## SOW-Q3-02 Recursive proofs

> **Status:** blocked until Ledger 10 is released · **Owner:** after Ledger 10 · **Last updated:** 2026-10-01

Recursive proofs cannot be tested until Ledger 10 is released ([record:9](https://github.com/midnightntwrk/midnight-network-ops/blob/a6e7daf8727bc61cfe15b422359ebeb0681ec6bb/releases/deliverables/2026-q3/2026-q3-deliverables.md)). The contributor map is kept so the parties are known when it unblocks. Gap rows 02-G1…G7 in the strategy doc stay as planned but are not scheduled.

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 (Compact `verifyProof`, AC-2) | dybvig | [compact#733](https://github.com/LFDT-Minokawa/compact/pull/733) "Add in-circuit proof verification" (open) | AC-2; 02-G2, G4, G6, G7 |
| R1 (Compact `verifyProof`, AC-2) | whankinsiv | [compact#794](https://github.com/LFDT-Minokawa/compact/pull/794) (merged); compact-end-2-end [#165](https://github.com/midnightntwrk/compact-end-2-end/pull/165) (inner-proof generation), [#168](https://github.com/midnightntwrk/compact-end-2-end/pull/168) (verifyProof regression) | AC-2; vendor harness |
| R1 (midnight-zk recursion, AC-1) | miguel-ambrona | 33 of the last 100 commits on [midnight-zk `aggregation/`](https://github.com/midnightntwrk/midnight-zk/commits/main/aggregation) | AC-1; 02-G1, G3 |
| R1 (midnight-zk recursion, AC-1) | iquerejeta | 9 commits on `aggregation/`; compact-end-2-end [#172](https://github.com/midnightntwrk/compact-end-2-end/pull/172) (recursive RSA-IVC proof verified in Compact) | AC-1; 02-G1, G3 |
| R2 | after Ledger 10 | there is no MPS | |
| R3 | after Ledger 10 | | |

---

## SOW-Q3-03 Dynamic cross-contract calls

> **Status:** L1 and L2 green on 2026-10-01 (preliminary report, not yet signed) · **Owner:** OpenZeppelin (partner) with Jay Albert (Foundation co-signer) · **Last updated:** 2026-10-02

This item already has a Foundation run in [`q3-ledger9/dynamic-calls`](../q3-ledger9/dynamic-calls/), with a [preliminary report](../q3-ledger9/reports/sow-q3-03-local-2026-10-01.md). It is here so that its owner and sign-off are recorded.

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | JosephDenman (Joseph Denman) | [compact#714](https://github.com/LFDT-Minokawa/compact/pull/714) "Dynamic cross-contract calls - Q3" (merged 2026-09-08); [midnight-js#1307](https://github.com/midnightntwrk/midnight-js/pull/1307) (the module provider, merged); co-author of [CoIP 4](https://github.com/LFDT-Minokawa/compact/blob/ca9da303cf00e3ee0083acfa360a7bfd74c11746/coips/coip-0004.md) | AC-1; co-signs the gap list 03-G1…G11; answers the CoIP 4 spec-drift finding (10 vs 11 failure kinds) |
| R1 | jonathan-sobel (Jonathan Sobel) | co-author of CoIP 4 (front-matter `Authors:`) | spec questions |
| R1 | kmillikin | committer of `coips/coip-0004.md` @ `ca9da30` | spec questions |
| R2 | **OpenZeppelin** (partner), contact **TBD**; **Jay Albert** (Foundation co-signer) | named by the Foundation: OpenZeppelin and the Foundation sign together (2026-10-01); Jay Albert as the Foundation co-signer (2026-10-02). GitHub `JAlbertCode` is *inferred*: company "Midnight Network", on the codeowners team, no profile name. Jay is not among the R1 handles found, so no conflict. No OpenZeppelin account appears among the R1 handles found, so no conflict. | AC-1 acceptance; both sign the report |
| R3 | Foundation run (`q3-ledger9`), done for L1 and L2 | [report JSON](../q3-ledger9/reports/sow-q3-03-local-2026-10-01.json) | AC-1, 03-G1…G7, G9, G10. Not yet done: G8, G11 |

Sign-off artefacts:
- R1 co-signs that the gap tests exercise CoIP 4 as designed, including the two failure kinds not driven: `PureInterfaceCircuit` and `UnreadableModule`.
- Both R2 signers sign the report JSON: the OpenZeppelin contact and Jay Albert. Until then the report stays preliminary.
- R1 answers the review findings in the strategy doc: spec drift, the gap in the migration guide, and the synchronous `resolve()`.

---

## SOW-Q3-04 Private state MIP

> **Status:** ready for review · **Owner:** Karmoola (MPS-0021 author, Foundation) · **Last updated:** 2026-10-01

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | kapke (Andrzej Kopeć) | [MIP PR #334](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/334) front-matter `Authors:` @ `49bbfd7` | review checklist; test stubs from normative text |
| R1 | jonathan-sobel (Jonathan Sobel) | the same front-matter; PR author | as above |
| R2 | Karmoola | [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/078a5a7fc3a0c908307f80c9daf35d5023527286/mps/mps-0021-phase2-contract-to-contract.md) `Authors: Karmel E - karmoola`; the MIP's `MPS: MPS-0021` | the MIP answers MPS-0021 |
| R3 | TBD | | [checklist](q3-testing-strategy.md#mip-and-design-review-checklist), AC-1 fact check |
| R4 | codeowners team, **excluding kapke** | review requested from the team; no review yet | AC-1 "submitted to the MIP process" |

Sign-off artefacts:
- R2 and R4 sign the AC-1 fact check (is the MIP in the process, and at which commit).
- R1 co-signs the test-stub list derived from the MIP's MUST and SHOULD statements.

---

## SOW-Q3-05 BABE phase 1

> **Status:** owner named · **Owner:** Ricardo Rius (`riusricardo`) · **Last updated:** 2026-10-01

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | Klapeyron | 17 of the 34 commits on [`main...efb3735`](https://github.com/midnightntwrk/midnight-node/compare/main...efb3735) (`demo-aura-to-babe-migration-q3`) | runbook walk-through; 05-G2 storage reads; runbook findings |
| R1 | LGLO | the other 17 of those 34 commits | as above |
| R2 | **Ricardo Rius** ([`riusricardo`](https://github.com/riusricardo)) | named by the Foundation, 2026-10-01; handle confirmed (GitHub profile name "Ricardo Rius"). On the codeowners team. Not a committer on the BABE branch, so no conflict. | AC-1 acceptance |
| R3 | TBD | this repo is the natural home for 05-G1, the DApp liveness probe | 05-G1, G3 |

Sign-off artefacts:
- R1 co-signs the 05-G1…G3 test design, especially which storage keys G2 reads. The runbook says no RPC exposes all four engine states.
- R1 answers the four runbook review findings in the strategy doc.
- R2 signs the probe report.

Dependency: a node 3.0.0 local-env with a compatible indexer and proof server. Ask R1 whether one exists.

---

## SOW-Q3-06 Block production rewards

> **Status:** 06-G2 blocked on `π` and `dist_fee` · **Owner:** Karmoola (MPS-0019 author, Foundation) · **Last updated:** 2026-10-01

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | MicroProofs | front-matter author of [MIP #321](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/321) @ `3019dbc` and [MIP #262](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262) @ `43b637c`; 25 of 32 commits on node [`main...d7c4404`](https://github.com/midnightntwrk/midnight-node/compare/main...d7c4404); all 139 on reserve-contracts [`main...bb2a358`](https://github.com/midnightntwrk/midnight-reserve-contracts/compare/main...bb2a358); [`MicroProofs/lace@3fc3166`](https://github.com/MicroProofs/lace/tree/3fc3166590bfc61ce6c5faf5d1d680376163a833) | demo reproduction; 06-G1; custom Lace access |
| R1 | luminight99 | front-matter co-author of #321 and #262 | MIP review |
| R1 | LGLO | 7 of 32 commits on the node branch | `pallet-block-rewards` storage and digest checks |
| R2 | Karmoola | [MPS-0019](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/5d881268081842bdd3b52bf6b4509c937de95c22/mps/mps-0019-block-production-rewards-night.md) `Authors: Karmel E - karmoola` (#321 answers it); [MPS-0033](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/078a5a7fc3a0c908307f80c9daf35d5023527286/mps/mps-0033-mnight-to-cnight.md) `Authors: Karmoola` (#262 answers it) | AC-1 acceptance; **decides the stakers-in-scope finding** |
| R3 | TBD | Cardano and db-sync experience needed | demo reproduction, 06-G1 |
| R4 | codeowners team | dzajkowski has reviewed #262 | MIP process |

Sign-off artefacts:
- R2 rules on the review finding in the strategy doc: the AC puts "payment to Ada stakers" out of scope, yet the demo pays `pool1` delegators.
- R1 supplies `π` and `dist_fee`, or names who sets them, to unblock 06-G2.
- R2 signs the demo-reproduction report.

---

## SOW-Q3-07 Shielded source of funds

> **Status:** ready for review · **Owner:** Jalal-1 and hbulgarini (MPS-0025 authors, Foundation) · **Last updated:** 2026-10-01 · time and materials, no ACs

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | kapke (Andrzej Kopeć) | the only `Authors:` entry in `mips/mip-xxxx-custom-spend-logic.md` on [MIP PR #335](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/335) @ `41d3b15`; PR author and assignee | answers review questions |
| R2 | Jalal-1 (Jalal Hannan), hbulgarini (Hector Bulgarini) | [MPS-0025](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/5d881268081842bdd3b52bf6b4509c937de95c22/mps/mps-0025-shielded-source-of-funds.md) `Authors:` | Designs A, B and C answer MPS-0025 |
| R3 | TBD | | [checklist](q3-testing-strategy.md#mip-and-design-review-checklist) |
| R4 | codeowners team, **excluding kapke** | hbulgarini is also on the team | MIP process |

There are no ACs. Sign-off is R2's design-review verdict against MPS-0025.

---

## SOW-Q3-08 Hard fork v8 to v9

> **Status:** owner named · **Owner:** Leonard Hegarty (`hegaleon`) · **Last updated:** 2026-10-01

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | ozgb | 5 commits on the record's `sow-q3-08-hard-fork-v8-v9/` folder; midnight-node [#1962](https://github.com/midnightntwrk/midnight-node/pull/1962) (8 → 9 migration exploration), [#1982](https://github.com/midnightntwrk/midnight-node/pull/1982) (ledger reads at the hard-fork block), [#2183](https://github.com/midnightntwrk/midnight-node/pull/2183), [#2206](https://github.com/midnightntwrk/midnight-node/pull/2206) (2.1.0 roll-up) | phase 0 local-env bring-up; phase 2 governance procedure; AC-2 runbook |
| R1 | jacek-kurkowski-shielded | 5 commits on the record's 08 folder | test-evidence questions |
| R1 (vendor QA) | Shielded QA Team; mhounslow; GiuseppeSalvatoreShielded | the 08 test evidence ("Tested by: Shielded QA Team"); compact-end-2-end [#143](https://github.com/midnightntwrk/compact-end-2-end/pull/143), [#181](https://github.com/midnightntwrk/compact-end-2-end/pull/181) (hard-fork campaigns), [#186](https://github.com/midnightntwrk/compact-end-2-end/pull/186) (rc regression) | reproduces QA once; "Not yet covered" list |
| R1 | gilescope | midnight-node [#2022](https://github.com/midnightntwrk/midnight-node/pull/2022), [#2134](https://github.com/midnightntwrk/midnight-node/pull/2134) (ledger 9 bumps) | ledger pin questions |
| R2 | **Leonard Hegarty** ([`hegaleon`](https://github.com/hegaleon)) | named by the Foundation, 2026-10-01; handle given by the Foundation, a midnightntwrk org member. Not among the R1 handles found, so no conflict. | AC-1 and AC-2 acceptance |
| R3 | TBD | this repo, since our `examples/` are the pre-fork DApps | phases 1 and 3 with our ledger 8 examples |

Sign-off artefacts:
- R1 (ozgb) co-signs the phase 0–3 rehearsal plan, especially the Council and TC accounts on local-env, which nobody has confirmed yet.
- R2 signs the local-env phase 3 report, then the report from each shared network.
- R2 signs AC-2 after observing the qanet and preprod drills.

---

## SOW-Q3-09 Throughput performance

> **Status:** owner named · **Owner:** BenB-MNF · **Last updated:** 2026-10-01 · time and materials, no ACs

| Role | Who | Evidence | Covers |
|---|---|---|---|
| R1 | dzajkowski (Dominik Zajkowski) | front-matter author of [MIP #312](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/312) @ `9ab5b9c` and [MIP #309](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/309) @ `6e3ba62`; co-author of [MPS PR #82](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/82) and of [MPS-0032](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/078a5a7fc3a0c908307f80c9daf35d5023527286/mps/mps-0032-storage-management.md) | report questions |
| R1 | chrispalaskas | midnight-node [#2041](https://github.com/midnightntwrk/midnight-node/pull/2041) (the combined experiment); reviewer on #312 and #309 | experiment data |
| R2 | **BenB-MNF** | named by the Foundation, 2026-10-01. Has reviewed [MPS PR #82](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/82), but is not an author of it, of MPS-0032, or of either MIP, so there is no conflict. On the codeowners team. The MPSs behind 09 are vendor-authored (MPS #82 by bobblessinghartley, dzajkowski and jrossie, all `@shielded.io`; MPS-0032 by dzajkowski), so this owner is named directly. | design review verdict |
| R3 | TBD. nstanford5 is a **requested reviewer** on #312 and #309. | `reviewRequests` on both PRs | report hash check (P1); [checklist](q3-testing-strategy.md#mip-and-design-review-checklist) |
| R4 | codeowners team, **excluding dzajkowski** | reviews so far: chrispalaskas and jsidorenko (#312); chrispalaskas and ozgb (#309); BenB-MNF, bwbush and bobblessinghartley (#82) | MIP process |

---

## Sign-off record

The owner's formal decision on each item's acceptance criteria. The owner signs in Notion, in the item's page, under **Formal sign-off** (the page quotes the ACs word for word from the record). An agent then copies the decision here, so the repo holds the record. This is the one fact that starts in Notion; see [`AGENTS.md`](AGENTS.md).

Decision values: `Not signed`, `Accepted`, `Accepted with conditions`, `Rejected`. A conditional acceptance or a rejection must list its conditions and link any open servicedesk tickets.

| SOW | Criteria | Signer(s) | Decision | Date | Conditions |
|---|---|---|---|---|---|
| 01 | AC-1, AC-2 | nstanford5 | Not signed | — | — |
| 02 | AC-1, AC-2 | owner after Ledger 10 | Not signed | — | — |
| 03 | AC-1 | OpenZeppelin (contact TBD); Jay Albert | Not signed | — | — |
| 04 | AC-1 | Karmoola | Not signed | — | — |
| 05 | AC-1 | riusricardo | Not signed | — | — |
| 06 | AC-1 (prototype; MIP) | Karmoola | Not signed | — | — |
| 07 | no ACs: design-review verdict | Jalal-1; hbulgarini | Not signed | — | — |
| 08 | AC-1, AC-2 (can be signed separately) | hegaleon | Not signed | — | — |
| 09 | no ACs: report checksum and review verdict | BenB-MNF | Not signed | — | — |

## People index

An affiliation is either *confirmed* by the Foundation or *inferred* from a hard signal; the column says which. "CO" marks a member of `@midnightntwrk/mn-codeowners-improvement-proposals`, as listed on 2026-10-01.

| Person | R1 on | R2 on | CO | Affiliation (confirmed or inferred, with source) |
|---|---|---|---|---|
| BenB-MNF | — (reviewer, #82) | 09 | yes | Foundation: `-MNF` handle suffix |
| bobblessinghartley | — (MPS #82 author) | — | yes | Shielded: `@shielded.io` email in MPS #82 |
| chrispalaskas | 09 | — | | |
| dybvig | 02 | — | | |
| dzajkowski | 09 (MPS #82 and MPS-0032 author too) | — | yes | Shielded: `@shielded.io` email in MPS #82 |
| gilescope | 08 | — | yes | |
| GiuseppeSalvatoreShielded | 08 | — | | Shielded: handle suffix |
| hbulgarini | — | 07 | yes | Foundation: confirmed by the Foundation, 2026-10-01 |
| hegaleon (Leonard Hegarty) | — | 08 | | |
| iquerejeta | 01, 02 | — | | |
| jacek-kurkowski-shielded | 08 | — | | Shielded: handle suffix |
| JAlbertCode (Jay Albert; handle *inferred*) | — | 03 (Foundation co-signer) | yes | Foundation: named by the Foundation, 2026-10-02 |
| Jalal-1 | — | 07 | | Foundation: confirmed by the Foundation, 2026-10-01 |
| jonathan-sobel | 03, 04 | — | | |
| JosephDenman | 03 | — | yes | |
| jrossie | — (MPS #82 author) | — | | Shielded: `@shielded.io` email in MPS #82 |
| kapke | 04, 07 | — | yes | |
| Karmoola | — | 04, 06 | yes | Foundation: confirmed by the Foundation, 2026-10-01 |
| Klapeyron | 05 | — | | |
| kmillikin | 03 | — | yes | |
| LGLO | 05, 06 | — | | |
| luminight99 | 06 | — | | |
| mhounslow | 08 | — | | |
| MicroProofs | 06 | — | | |
| miguel-ambrona | 02 | — | | |
| nstanford5 | — | 01 | yes | Foundation: the account owner's `midnight.foundation` email |
| OpenZeppelin (organisation, contact TBD) | — | 03, with Jay Albert | | partner: named by the Foundation, 2026-10-01 |
| ozgb | 08 | — | | |
| riusricardo (Ricardo Rius) | — | 05 | yes | |
| whankinsiv | 02 | — | | |

## Conflicts and open assignments

Conflicts (from the role rules):
- kapke is CO and authored #334 and #335, so cannot be the R4 gate for 04 or 07.
- dzajkowski is CO and authored #309, #312 and both MPSs they answer, so cannot be R2 or R4 for 09.
- LGLO is R1 on both 05 and 06, so is excluded as R3 for either.

Other open assignments, still to fill:
- [ ] R3 independent tester for 04, 05, 06, 07, 08 and 09.
- [ ] Affiliations for the blank rows, plus which external partners (if any) take an R3 slot.

## Open questions

Items that need a named Foundation owner. Each one blocks sign-off on that item. They are tracked in ClickUp, with this list as the record. Question ids stay fixed once assigned; a resolved question is struck through, not deleted.

- ~~**Q1. SOW-09 throughput: who is the Foundation owner?**~~ **Resolved 2026-10-01:** BenB-MNF owns it.
- **Q2. SOW-02 recursive proofs: who owns it when Ledger 10 is released?** It is deferred, so nobody is named now. Name the owner when Ledger 10 is scheduled, so the gap tests 02-G1…G7 can start straight away.
- ~~**Q3. SOW-01: who signs off the report already filed?**~~ **Resolved 2026-10-01:** nstanford5 signs.
- ~~**Q4. SOW-03: who at OpenZeppelin signs, and does the Foundation co-sign?**~~ **Resolved in part:** the Foundation co-signs with OpenZeppelin (2026-10-01), and Jay Albert is the Foundation co-signer (2026-10-02). Still open: the named OpenZeppelin contact and their GitHub handle.

## ClickUp: action for Tracie Mitchell (not yet linked)

The Q3 SOW work is already tracked in ClickUp, in tasks Tracie Mitchell created and owns. **None of them is linked to these docs or to the Notion mirror yet.** Whether to link them is Tracie's call.

| ClickUp task | Where | Notes |
|---|---|---|
| [SOW Q3 - MNF ACCEPTANCE](https://app.clickup.com/t/123xrj7kcyu) | Program Timeline (Work Milestone) | Assignees: Tracie Mitchell, Nick Stanford, Leonard Hegarty. 2026-09-30 → 2026-10-14. Description links only the delivery record; no subtasks or checklists. |
| `SOW-Q3-01` … `SOW-Q3-09` Deliverable tasks, e.g. [SOW-Q3-01](https://app.clickup.com/t/86ca9ug8m) | Midnight Roadmap › Roadmap | One per item, each carrying its ACs. Not linked to the acceptance milestone. |

**If you are an agent working for Tracie Mitchell** (or you are acting in ClickUp on these tasks), **ask her first** whether she wants them linked. Do not change her tasks without a yes. The options to offer are:
1. Add this doc's open questions and open assignments as subtasks or a checklist under *SOW Q3 - MNF ACCEPTANCE*.
2. Link that milestone to the nine `SOW-Q3-0N` Deliverable tasks.
3. Put the Notion hub and these two docs in the milestone's description, and add each task's URL to the matching section here and to its Notion row.

Record her answer here, with the date, and then mirror it in Notion.

## How this was gathered

Run on 2026-10-01 with `gh` as nstanford5. Re-run these before a sign-off round.

```bash
R=midnightntwrk/midnight-improvement-proposals
# MIP authors: front-matter at the PR head
for n in 334 321 262 335 312 309 82; do
  sha=$(gh pr view $n -R $R --json headRefOid -q .headRefOid)
  for f in $(gh pr view $n -R $R --json files -q '.files[].path' | grep '\.md$'); do
    gh api "repos/$R/contents/$f?ref=$sha" -H 'Accept: application/vnd.github.raw' | sed -n '1,25p'
  done
done
# Reviewers and requested reviewers
gh api repos/$R/pulls/<n>/reviews -q '[.[].user.login]|unique'
gh pr view <n> -R $R --json reviewRequests
# Codeowners team
gh api orgs/midnightntwrk/teams/mn-codeowners-improvement-proposals/members -q '[.[].login]'
# Branch-only commits (prototype builders)
gh api repos/midnightntwrk/midnight-node/compare/main...efb3735 -q '[.commits[].author.login]|group_by(.)|map("\(.[0])=\(length)")'
gh api repos/midnightntwrk/midnight-node/compare/main...d7c4404 -q '...same...'
gh api repos/midnightntwrk/midnight-reserve-contracts/compare/main...bb2a358 -q '...same...'
# Record folder authors (all planetearp, the record compiler, except 08)
gh api "repos/midnightntwrk/midnight-network-ops/commits?sha=a6e7daf&path=releases/deliverables/2026-q3/<folder>"
```
