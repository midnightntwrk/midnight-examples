# From a request to a design card (step 1)

Step 1 of the [generation flow](generation-flow.md) turns a request ("build a
private tip jar…") into a design card: the example's `SPEC.md`, written before
any code. A person reviews the card, and the pipeline scaffolds the example from
it. This page is the prompt for drafting the card. It is written for an agent,
and works as a checklist for a person too.

## Start

```bash
npm run pipeline -- <name>
```

Pick `<name>` first: kebab-case, short, named after what a user does
(`private-tip-jar`, `silent-auction`), and not already under `examples/`. With
no `examples/<name>` yet, the pipeline writes a blank card to
`.cards/<name>.md` (gitignored) and stops. Fill that file in.

## Read, in this order

1. [`examples/private-tip-jar/SPEC.md`](../examples/private-tip-jar/SPEC.md): a
   finished card. Match its level of detail.
2. [`patterns.md`](patterns.md): find the 1–2 nearest examples, and read their
   `SPEC.md` if the design is close.
3. The comments in the blank card, which say what each section needs.

Don't read code yet. The card describes the design; the contract comes after
the review.

## Fill in every section

- **Purpose**: one or two sentences: what a user can do, and what stays private.
- **Roles**: each actor and how the contract recognises them (a hashed secret
  from a witness, a coin public key, anyone).
- **Public ledger fields**: every `export ledger` field and why it has to be
  public. Keep this list short: anything not here must not be on chain.
- **Private state**: what each role keeps off chain, and where it comes from.
- **Circuits**: one row per exported circuit. Give every assert with its exact
  message: each one becomes a negative test.
- **Witnesses**: one row per witness, or "None.". This decides whether the
  example is scaffolded with `--witnesses`, so there's no separate choice to
  make. A role recognised by a secret needs a witness to supply it.
- **Privacy invariants**: one ``- Never on chain: … → `key` `` line per secret.
  The key names the `assertNotInPublicState` entry that will check it
  (`tipperCoinPublicKey`, `ownerSecretKey`). Write "None." only if the example
  keeps no secrets.
- **Accepted leaks**: what an observer does learn (amounts, counts, timing,
  which circuit ran), and why that's acceptable here.
- **Out of scope**: what the example deliberately doesn't do.
- **Test-only contracts**: a contract that exists only so the tests can run
  (a demo token), or "None.".

Every heading stays. Write "None." under one that doesn't apply.

## Lint, then stop

```bash
npm run pipeline -- <name> --spec .cards/<name>.md
```

Fix what the design lint reports and run it again. Once the card passes,
`next.kind` is `review` and the run exits 0. **Stop there.** Tell the person the
card is ready for review, with a short summary of the roles, the circuits and
what stays private.

The person reviews the design. If it's right, they add this line under the
card's title:

```
Reviewed-by: <who>, <YYYY-MM-DD>
```

Never add that line yourself, and don't start the contract before it's there.
With it, the same command scaffolds `examples/<name>` from the card (with
`--witnesses` if the card declares witnesses), runs `npm install`, and moves on
to step 3a.
