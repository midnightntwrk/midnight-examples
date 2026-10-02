# SOW3 acceptance: status and changelog

- **Generated:** 2026-10-02 18:15 UTC by `/sow3-update`
- **Notion last synced:** 2026-10-02 from the uncommitted working tree on `import-examples` (the repo docs this reflects)
- **Source:** [SOW3 hub in Notion](https://app.notion.com/p/3ed4057b9f2381f49681d7f96458e796), a display copy of the repo docs [testing strategy](https://github.com/midnightntwrk/midnight-examples/blob/import-examples/experimental/q3-delivery/q3-testing-strategy.md) and [who tests and signs off](https://github.com/midnightntwrk/midnight-examples/blob/import-examples/experimental/q3-delivery/q3-test-ownership.md). If this file and Notion disagree, Notion is newer.

All nine Q3 deliverables now have named owners, and most have two. Eight are at "Owner named". SOW-02 is still blocked until Ledger 10, with provisional owners. Foundation testing has passed for SOW-01 (crypto schemes) and SOW-03 (dynamic cross-contract calls), and both reports wait for sign-off. No item is signed off yet. The most important next steps: the two SOW-01 owners sign that report, and the OpenZeppelin contact for SOW-03 gets named.

## Since last update (2026-10-02 02:03 UTC)
- SOW-01 Crypto schemes: Tested – awaiting sign-off → Owner named. Jalal Hannan added as a second owner, alongside Nick Stanford. (Notion sync of 2026-10-02)
- SOW-02 Recursive proofs: Jalal Hannan and Mahesh Sashital named as provisional owners, to be confirmed when Ledger 10 is scheduled. Webisoft added as a partner. Independent tester now reads "Ledger 10". (Notion sync of 2026-10-02)
- SOW-03 Dynamic cross-contract calls: Tested – awaiting sign-off → Owner named. Ricardo Rius added as a second Foundation signer, alongside Jay Albert. Midnames added as a partner. (Notion sync of 2026-10-02)
- SOW-04 Private state MIP: Ready for review → Owner named. Ricardo Rius added as a second owner, alongside Karmel Elshinnawi. (Notion sync of 2026-10-02)
- SOW-07 Shielded source of funds: Ready for review → Owner named. Mahesh Sashital replaces Hector Bulgarini as owner, alongside Jalal Hannan. (Notion sync of 2026-10-02)
- SOW-09 Throughput performance: Mahesh Sashital added as a second owner, alongside Ben Beckmann. (Notion sync of 2026-10-02)
- New comment on the hub from Tracie Mitchell (2026-10-02). She has linked the hub to the ClickUp acceptance milestone and says this is sufficient for now. The SOW3 items are already linked to a program milestone through a release. She will track in the background. The ClickUp question is still listed as open.
- Notion last synced moved from commit `c996be8` to the uncommitted working tree on `import-examples`: the repo docs were updated to match the owner and status changes above.
- Flag: on SOW-02, "Next step" still reads "Name an owner when Ledger 10 is scheduled", although provisional owners are named. On SOW-03, the "Partner / co-signer" field and the "Next step" field ("then both sign") still describe a single Foundation signer.

## Snapshot
| SOW | Item | Status | Owner | Independent tester | Testability | Blocked by | Next step | Sign-off |
|---|---|---|---|---|---|---|---|---|
| [01](https://app.notion.com/p/3ed4057b9f238171be1ccf77258ed2ef) | Crypto schemes: Ed25519 and P-256 signatures | Owner named | Nick Stanford, Jalal Hannan | Foundation (q3-ledger9) | A – easy to test here | — | Owner signs the test report. Decide whether to ask Shielded QA to re-run on runtime rc.4. | Not signed |
| [02](https://app.notion.com/p/3ed4057b9f238122b6b2e4ca0b25e5aa) | Recursive proofs | Blocked | Jalal Hannan, Mahesh Sashital (provisional); partner Webisoft | Ledger 10 | B – needs special setup | Ledger 10 release | Name an owner when Ledger 10 is scheduled. | Not signed |
| [03](https://app.notion.com/p/3ed4057b9f2381f5979efbadb98008c9) | Dynamic cross-contract calls | Owner named | Jay Albert, Ricardo Rius; with OpenZeppelin (contact TBD) and Midnames | Foundation (q3-ledger9), done | A – easy to test here | — | Name the OpenZeppelin contact; then both sign the report. | Not signed |
| [04](https://app.notion.com/p/3ed4057b9f238164be25e4d73e12df07) | Private state across contracts (MIP) | Owner named | Karmel Elshinnawi, Ricardo Rius | TBD | D – document review | — | Review the proposal against MPS-0021; confirm it is in the MIP process. | Not signed |
| [05](https://app.notion.com/p/3ed4057b9f23811a94fec3a5b5edbfeb) | BABE block production, phase 1 | Owner named | Ricardo Rius | TBD | C – infrastructure team tests | A node 3.0.0 local network with matching indexer and proof server | Agree the DApp check with the builders; find a test network. | Not signed |
| [06](https://app.notion.com/p/3ed4057b9f23812284f2eebba295b633) | Block production rewards | Owner named | Karmel Elshinnawi | TBD | C – infrastructure team tests | Reward parameters π and dist_fee not set | Owner decides whether paying stakers is in scope; builders set the reward parameters. | Not signed |
| [07](https://app.notion.com/p/3ed4057b9f2381ffaac4de33c8c13df4) | Shielded source of funds | Owner named | Jalal Hannan, Mahesh Sashital | TBD | D – document review | — | Owners review the three designs against MPS-0025. | Not signed |
| [08](https://app.notion.com/p/3ed4057b9f2381d7b3dcc8de41dc4851) | Hard fork: Ledger 8 → 9 | Owner named | Leonard Hegarty | TBD | B – needs special setup | Local fork environment bring-up | Agree the local rehearsal plan with the builders; get qanet access. | Not signed |
| [09](https://app.notion.com/p/3ed4057b9f23811c8feafac2603c21b0) | Throughput performance | Owner named | Ben Beckmann, Mahesh Sashital | TBD | D – document review | — | Check the report's checksum; review the two proposals. | Not signed |

Built by, per item: 01 iquerejeta · 02 dybvig, whankinsiv, miguel-ambrona, iquerejeta · 03 JosephDenman, jonathan-sobel, kmillikin · 04 kapke, jonathan-sobel · 05 Klapeyron, LGLO · 06 MicroProofs, luminight99, LGLO · 07 kapke · 08 ozgb, jacek-kurkowski-shielded, Shielded QA (mhounslow, GiuseppeSalvatoreShielded), gilescope · 09 dzajkowski, chrispalaskas.

## Sign-offs
None yet: all nine items are Not signed.

## Open questions
- **SOW-03:** Who signs for OpenZeppelin? Jay Albert and Ricardo Rius sign for the Foundation, and Midnames is listed as a partner. The test report is waiting for the OpenZeppelin contact.
- **SOW-01:** Re-run on the newer runtime? Shielded QA tested on on-chain runtime rc.3, but the delivery lists rc.4. Our own tests ran on rc.4. Ask Shielded to re-run, or is ours enough? This feeds into the SOW-01 sign-off.
- **SOW-08:** Who gives us qanet access, and who schedules our checks on each network as the fork rolls out? Needed for the readiness-for-mainnet criterion.
- **SOW-04 to SOW-09:** Independent testers. None assigned yet (parked).
- **SOW-02:** Owner for recursive proofs. Jalal Hannan and Mahesh Sashital are named for now, with Webisoft as partner; confirm them when Ledger 10 is scheduled.
- **SOW-06:** The reward parameters `π` and `dist_fee` are not set, so the reward maths can't be checked yet.
- **SOW-05:** A test network: a local network on node 3.0.0 with a matching indexer and proof server.
- **SOW-06:** Get the custom Lace wallet build, or confirm a command-line path is enough.
- **All:** Contribute our compiler-level tests upstream? Decide whether they move to Shielded's test suite, stay here, or both.
- **ClickUp (action for Tracie Mitchell):** Should her ClickUp tasks (SOW Q3 - MNF ACCEPTANCE and the nine SOW-Q3-0N tasks) be linked to the Notion hub and the repo docs? Tracie replied in a comment on 2026-10-02 (see below). The item is still listed as open.

**Resolved in the last 14 days:**
- 2026-10-02: Foundation co-signer for SOW-03: Jay Albert.
- 2026-10-02: A servicedesk label for Q3 tickets, `q3sow26`, was created.
- 2026-10-01: Owner for throughput (SOW-09): Ben Beckmann.
- 2026-10-01: Who signs crypto schemes (SOW-01): Nick Stanford.
- 2026-10-01: Does the Foundation co-sign SOW-03 with OpenZeppelin? Yes.
- 2026-10-01: Are the problem-statement authors for SOW-04, 06 and 07 Foundation people? Yes.

## Unanswered comments
- **Hub**, Tracie Mitchell, 2026-10-02: she has linked the hub to the ClickUp milestone and says that is sufficient for now. The SOW3 items are already in ClickUp through a release, and she will track this in the background. No reply yet; not resolved.

## Glossary
- **SOW:** statement of work. The nine items Shielded delivered in Q3 2026.
- **Shielded:** the vendor that built and QA-tested the deliverables.
- **Foundation acceptance:** the Midnight Foundation's own independent test of each item against its acceptance criteria, followed by the owner's formal sign-off.
- **MIP:** Midnight Improvement Proposal, a design proposal reviewed through a GitHub process.
- **MPS:** Midnight Problem Statement, the problem a MIP answers. Its author is usually the item's owner.
- **Ledger 9 / Ledger 10:** versions of the Midnight ledger. Hard fork SOW-08 moves the network from 8 to 9; SOW-02 needs 10.
- **BABE:** a block-production method; SOW-05 migrates the node to it from the current method (Aura).
- **qanet / preprod:** shared Midnight test networks.
- **q3-ledger9:** the Foundation's acceptance test suite in the midnight-examples repo.
- **OpenZeppelin:** a partner organisation co-signing SOW-03.
- **Midnames, Webisoft:** partner organisations listed on SOW-03 and SOW-02; their roles are not stated yet.
- **Servicedesk:** the GitHub repo where bugs found in testing are reported; Q3 tickets carry the `q3sow26` label.

## Changelog
### 2026-10-02
- Second owners named: Jalal Hannan on SOW-01, Ricardo Rius on SOW-03 (Foundation signer) and SOW-04, and Mahesh Sashital on SOW-09. On SOW-07, Mahesh Sashital replaces Hector Bulgarini.
- SOW-02: Jalal Hannan and Mahesh Sashital named as provisional owners, with Webisoft as partner.
- SOW-03: Midnames added as a partner.
- Statuses: SOW-01 and SOW-03 Tested – awaiting sign-off → Owner named; SOW-04 and SOW-07 Ready for review → Owner named.
- Tracie Mitchell commented on the hub about ClickUp linking; the question is still listed as open.
- Repo docs updated to match; Notion last synced from the uncommitted working tree on `import-examples`.
- Baseline: first snapshot taken from Notion.
- Jay Albert named as the Foundation co-signer for SOW-03 (dynamic cross-contract calls).
- Servicedesk label `q3sow26` created for Q3 tickets.

### 2026-10-01
- Ben Beckmann named owner of SOW-09 (throughput performance).
- Nick Stanford named signer for SOW-01 (crypto schemes).
- Decided: the Foundation co-signs SOW-03 with OpenZeppelin.
- Confirmed: the problem-statement authors for SOW-04, 06 and 07 are Foundation people.
- Decided: open questions are tracked in ClickUp.
