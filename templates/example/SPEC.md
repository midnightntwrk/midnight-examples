# SPEC — __Title__

<!--
The design card for this example (generation flow step 1, docs/generation-flow.md).
Write it before any Compact: a human reviews this design, not the code.
Keep every heading. Write "None." under a heading that doesn't apply.
Once the code exists, this file and the code must agree: update this file in the
same change as the code.
-->

## Purpose

<!-- One or two sentences: what a user can do, and what stays private. -->

## Roles

<!-- Each actor, and how the contract recognises them (a hashed witness key, a
coin public key, anyone). -->

| Role | Recognised by | Can |
|---|---|---|

## Public ledger fields

<!-- Every `export ledger` field: its type, who writes it, and why it must be
public. Anything not listed here must not be on chain. -->

| Field | Type | Written by | Why public |
|---|---|---|---|

## Private state

<!-- What each role keeps off chain (the PrivateState type in
contract/witnesses.ts), and where it comes from. -->

## Circuits

<!-- One row per exported circuit. "Asserts" lists every guard, with its exact
message; each one gets a negative test. -->

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|

## Witnesses

<!-- One row per `witness` declaration. Must match the --witnesses flag: none
here means no --witnesses. -->

| Witness | Returns | From private state |
|---|---|---|

## Privacy invariants

<!-- "Never on chain: …", one line per secret. Each line becomes an entry in
the assertNotInPublicState call in src/test/__name__.sim.test.ts. -->

- Never on chain:

## Accepted leaks

<!-- What an observer does learn, and why that's acceptable here: amounts,
counts, timing, circuit names, links through fees or reused keys. -->

-

## Out of scope

<!-- What this example deliberately doesn't do. -->

-
