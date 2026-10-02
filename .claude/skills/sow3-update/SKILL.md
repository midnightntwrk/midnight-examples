---
name: sow3-update
description: Regenerate experimental/q3-delivery/SOW3-STATUS.md, the rolling SOW3 (Q3 2026 SOW) acceptance status and changelog uploaded to the team's Claude Project. Reads the Notion SOW3 mirror only and never writes to it. Use when asked for a SOW3 status update, daily progress update, changelog, or "refresh the Claude Project file".
---

# /sow3-update: SOW3 rolling status and changelog

You produce **one file**, `experimental/q3-delivery/SOW3-STATUS.md`. Nick uploads it to a
Claude Project, replacing the previous copy, so that the Project always knows the team's
latest status and what changed recently. The file has a current snapshot on top and a
dated changelog below it, trimmed to 14 days. Git keeps the older versions.

**Source: the Notion SOW3 mirror, read-only.** Notion is a display copy of the md docs in
`experimental/q3-delivery/`, and is where owners sign off and comment. Read
`experimental/q3-delivery/AGENTS.md` first. It has the page ids, the data source, the
field map and the GitHub ↔ Notion people table, which you need to turn `user://` ids into
names.

## Guardrails

- **Make no Notion writes**: no `update-page`, `create-comment` and so on. Comments are
  change requests for the md-sync workflow, not for this skill. Only list them.
- **Make no ClickUp calls.** Those tasks belong to Tracie Mitchell (see AGENTS.md).
- **Do not fix mismatches.** If Notion contradicts itself, or contradicts the previous
  file in a way that is not a plausible change, flag it under "Since last update" and
  move on.
- Never hand-edit `SOW3-STATUS.md` outside this procedure. Commit it only if Nick asks.

## 1. Load the previous file

Read `experimental/q3-delivery/SOW3-STATUS.md` if it exists. Take from it the
`Generated:` timestamp, the Snapshot table, the Sign-offs, Open questions (open and
resolved), Unanswered comments and the Changelog entries. If there is no file, this is
the **baseline** run.

## 2. Gather from Notion

Load the tools with
`ToolSearch("select:mcp__claude_ai_Notion__notion-fetch,mcp__claude_ai_Notion__notion-query-data-sources,mcp__claude_ai_Notion__notion-get-comments")`,
then make these calls, in parallel where you can:

1. `notion-fetch` the hub `3ed4057b9f2381f49681d7f96458e796` with
   `include_discussions: true`. Take:
   - the **Last synced** line in the top callout (the date and the commit);
   - the **Open questions** list, and the **Resolved** toggle with its dates;
   - the **Conflicts of interest** toggle;
   - any action callouts, for example the one asking Tracie about ClickUp.
2. `notion-query-data-sources` with
   `{"mode":"rows","data_source_url":"collection://ebc24561-56ca-44be-acda-a68430b751e8","limit":20}`.
   Expect 9 rows; flag it if there are more or fewer. For each row keep: SOW, Deliverable,
   Type, Status, Owner, Partner / co-signer, Built by, Independent tester, Testability,
   Blocked by, Next step, Sign-off, Signed by, Signed on, Conditions, and the `url`.
3. `notion-get-comments` with `include_all_blocks: true, include_resolved: true` on the
   hub and on each of the nine row page ids in AGENTS.md. For each discussion keep: page,
   author, date, text, resolved or not, and whether anyone replied.
4. For any row whose **Sign-off** is not `Not signed`, `notion-fetch` that row page and
   read its **Formal sign-off** section: the "Decision on each criterion" table and the
   Statement.

## 3. Diff against the previous file

Compare field by field per SOW, and list by list for questions and comments. Write one
changelog bullet per real change, in plain English:

- the status moved, as `SOW-05 BABE: Owner named → Ready for review`;
- an owner, co-signer, partner contact or independent tester was named or changed;
- Blocked by was set or cleared; Next step changed (summarise the new step);
- a **sign-off** was recorded: who, the decision, the date, any conditions. This is the
  most important kind of entry, so put it first;
- a question was opened or resolved (with its resolution);
- a new comment: who and what, in one line, on which item;
- the Notion Last-synced date or commit moved, which means the repo docs changed.

Attribute a bullet to a person when Notion names one (the comment author, Signed by, the
resolved-question entry). Otherwise write "(Notion sync of <date>)". Report what changed
only. Do not guess why.

Baseline run: the changelog gets a single entry, "Baseline: first snapshot taken from
Notion", followed by the questions the hub shows as resolved, each with its own date.

## 4. Write `SOW3-STATUS.md`

Use the exact sections below, in this order. Dates are `YYYY-MM-DD` and times are UTC.

```markdown
# SOW3 acceptance: status and changelog

- **Generated:** <YYYY-MM-DD HH:MM UTC> by `/sow3-update`
- **Notion last synced:** <date> from commit `<sha>` on `<branch>` (the repo docs this reflects)
- **Source:** [SOW3 hub in Notion](https://app.notion.com/p/3ed4057b9f2381f49681d7f96458e796), a display copy of the repo docs [testing strategy](…) and [who tests and signs off](…). If this file and Notion disagree, Notion is newer.

<2–4 sentence plain-English summary: how many of the nine items are tested, awaiting sign-off, blocked, or not started; the single most important next action.>

## Since last update (<previous Generated, or "baseline">)
- bullets from step 3, or "No changes."

## Snapshot
| SOW | Item | Status | Owner | Independent tester | Testability | Blocked by | Next step | Sign-off |
<one row per SOW, ordered 01–09; link the SOW cell to its Notion row page; people by name, not id; "—" for empty>

## Sign-offs
<only rows whose Sign-off ≠ Not signed: signer, decision, date, conditions, per-criterion decisions. Otherwise: "None yet: all nine items are Not signed.">

## Open questions
<the hub's open list, one line each, prefixed with the SOW it concerns>
**Resolved in the last 14 days:** <with dates>

## Unanswered comments
<discussions with no reply and not resolved: item, author, date, one-line gist. Otherwise "None.">

## Glossary
<one line each, only for terms that appear above: SOW, MIP, MPS, DUST, Ledger 9/10, BABE, OpenZeppelin, Shielded, …>

## Changelog
### YYYY-MM-DD
- …
```

Rules for the changelog:
- Entries go newest first. A second run on the same date **merges** into that date's
  entry, with no duplicate bullets; it does not add a second heading.
- A run that finds no changes adds no bullet to the changelog. "Since last update" says
  "No changes."
- Drop entries dated more than 14 days before today.

## 5. Style

Follow the Notion writing rules in AGENTS.md. Write for non-developers. Use no gap ids
(`01-G4`) and no role codes (R1–R4). Explain MIP, MPS and DUST once, in the Glossary.
Write GitHub handles as they are in "Built by", and use names for owners. Keep the file
under 20 KB: shorten Next-step text before you drop any field.

## 6. Finish

Print the file path, the size in KB, and the "Since last update" bullets, or "no
changes". Remind Nick to replace `SOW3-STATUS.md` in the Claude Project's files.
