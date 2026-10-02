# AGENTS.md: q3-delivery

Instructions for agents working in this directory. Read the repo-root [`AGENTS.md`](../../AGENTS.md) first.

## What this is

The Foundation's acceptance plan for the Q3 2026 SOW deliverables:

- [`q3-testing-strategy.md`](q3-testing-strategy.md): what we test for each item, and why. It also holds the gap rows, the servicedesk reporting rules and the open questions.
- [`q3-test-ownership.md`](q3-test-ownership.md): who builds, owns, tests and signs off each item, with evidence for every name.
- [`STL 2026-q3-deliverables.md`](STL%202026-q3-deliverables.md): a byte-identical copy of Shielded's delivery record. **Never edit it**; refresh it only from the canonical record.

The tests themselves live in [`../q3-ledger9/`](../q3-ledger9/), which has its own `AGENTS.md`.

## The Notion mirror: keep it in sync

The two `.md` files above are mirrored in Notion as a display copy for non-developers on the team:

| What | Where |
|---|---|
| Hub page "SOW3" (Product › DevX) | https://app.notion.com/p/3ed4057b9f2381f49681d7f96458e796 |
| Database "Q3 SOW deliverables" | https://app.notion.com/p/eb507520f12545dcb2bdf2e04f4f99e8 |
| Its data source (for row writes) | `collection://ebc24561-56ca-44be-acda-a68430b751e8` |
| Views | Table `view://440a9bf8-245e-48b8-ac0a-02a978bfffe6`, Board by status `view://3ed4057b-9f23-81f9-b8be-000cefe95f9b` |

Row pages, one per item:

| SOW | Row page id |
|---|---|
| 01 | `3ed4057b-9f23-8171-be1c-cf77258ed2ef` |
| 02 | `3ed4057b-9f23-8122-b6b2-e4ca0b25e5aa` |
| 03 | `3ed4057b-9f23-81f5-979e-fbadb98008c9` |
| 04 | `3ed4057b-9f23-8164-be25-e4d73e12df07` |
| 05 | `3ed4057b-9f23-811a-94fe-c3a5b5edbfeb` |
| 06 | `3ed4057b-9f23-8122-84f2-eebba295b633` |
| 07 | `3ed4057b-9f23-81ff-aac4-de33c8c13df4` |
| 08 | `3ed4057b-9f23-81d7-b3dc-c8de41dc4851` |
| 09 | `3ed4057b-9f23-811c-8fea-fac2603c21b0` |

### Rules

- **The `.md` files are canonical.** Notion is a display copy. Never change Notion first, and never treat a Notion edit as the source of a fact.
- **One exception: formal sign-off starts in Notion.** Owners sign in each item page's **Formal sign-off** section and in the row's `Sign-off`, `Signed by`, `Signed on` and `Conditions` fields. When you sync, read those fields and the page's decision tables, and copy them into the [Sign-off record](q3-test-ownership.md#sign-off-record) in `q3-test-ownership.md`, with the date. A signature counts only if the signer is that item's named owner or co-signer; otherwise, flag it and do not copy it. When a decision is recorded, also set the row's `Status` and the item's status block in both md files.
- **Every change to `q3-testing-strategy.md` or `q3-test-ownership.md` that touches an owner, a status, a signer, an open question, the servicedesk rules or a conflict of interest must be synced to Notion in the same piece of work.** Gap-row and evidence-only changes do not need a sync, because Notion links to the md for detail.
- **After syncing, update the "Last synced" line** in the hub's top callout: the date, and the git commit, or "uncommitted working tree on `<branch>`".
- **Comments in Notion are change requests.** Read them (`get_comments` on the hub and row pages), make the change in the md, sync it, then reply to the comment with what changed.
- **Before writing to Notion, fetch the page.** Make the smallest edit (`update_content` search-and-replace). Do not replace a whole page: rows, views and the inline database live inside the hub.
- **Do not delete rows.** An item that is finished keeps its row, with Status updated.
- **Open questions keep their place.** A resolved question moves into the hub's collapsed "Resolved" toggle, with the date. The md keeps its question ids (Q1…) fixed and strikes resolved ones through.
- **Write for non-developers.** Use no gap ids (`01-G4`) or role codes (R1–R4) in the Notion text, and explain terms like MIP, MPS and DUST the first time they appear. Keep the detail in the md, behind a link. GitHub handles are fine in "Built by"; use Notion user mentions for owners.

### Field map: md → Notion

| md source | Notion |
|---|---|
| `q3-test-ownership.md` › Summary table: R2 owner | row `Owner` (people) and row page "Who's involved" |
| the same table: R1 authors / builders | row `Built by` |
| the same table: R3 tester | row `Independent tester` |
| the same table: State, plus the item's status block in the strategy doc | row `Status`: one of Tested – awaiting sign-off · Ready for review · Owner named · Blocked · Not started |
| the strategy doc's Triage table: Tier | row `Testability` (A–D) |
| the strategy doc's Triage table: Blocker; each item's dependencies | row `Blocked by` |
| the next action implied by the open questions and sign-off | row `Next step` |
| a partner or co-signer, e.g. SOW-03 OpenZeppelin | row `Partner / co-signer` |
| `STL 2026-q3-deliverables.md`: each item's "Acceptance criteria" list, **word for word** | row page "Acceptance criteria": one `###` per AC, with the verbatim quote, then "In plain English", "How we check it" and "Evidence so far". For an item with no ACs (07, 09), a "Review questions" list |
| the item section's "Sign-off artefacts" in `q3-test-ownership.md` | row page "Formal sign-off › Before you sign" checklist |
| `q3-test-ownership.md` › Sign-off record ← **copied from Notion**, not to it | row `Sign-off`, `Signed by`, `Signed on`, `Conditions`, and the page's "Decision on each criterion" and "Statement" tables |
| `q3-test-ownership.md` › Open questions, plus the strategy doc's Open questions | hub "Open questions" list, and its "Resolved" toggle |
| the strategy doc › Reporting bugs and issues | hub "Found a problem?" section (condensed) |
| `q3-test-ownership.md` › Conflicts | hub "Conflicts of interest" toggle |
| the role rules (R1–R4) | hub "How sign-off works" table (in plain English) |

### People: GitHub ↔ Notion

| GitHub | Name | Notion user | Notes |
|---|---|---|---|
| nstanford5 | Nick Stanford | `user://2c7d872b-594c-81f3-b6f1-0002abe01a30` | |
| riusricardo | Ricardo Rius | `user://299d872b-594c-817d-a5d2-00024fb76229` | |
| hegaleon | Leonard Hegarty | `user://2fbd872b-594c-81f7-b8a8-0002ba65202e` | |
| BenB-MNF | Ben Beckmann | `user://2a3d872b-594c-81fe-8d15-0002e6b5904a` | match by name only (*inferred*) |
| Karmoola | Karmel Elshinnawi | `user://2c3d872b-594c-81dd-b81c-000253b0257c` | |
| Jalal-1 | Jalal Hannan | `user://25ad872b-594c-8192-bddf-00026c1058fc` | |
| hbulgarini | Hector Bulgarini | `user://2bfd872b-594c-8185-854e-0002b40cacf0` | |
| JAlbertCode | Jay Albert | `user://2e2d872b-594c-817a-b84e-0002d85ae7a7` | GitHub handle *inferred* (company "Midnight Network", no profile name) |
| — | OpenZeppelin | none | a partner organisation; write it as text |

For anyone not in this table, find their Notion user with a user search before mentioning them. If you can't find one, write the name as plain text.
