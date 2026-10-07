# The scripted generation pipeline

> **Status: living draft.** This is the working definition of the scripted
> generation pipeline: how a prompt becomes a running DApp using the scripts and
> references in this repo. Expect it to change as the pipeline is refined. Edit
> it here and note the change in the [changelog](#changelog).

The pipeline alternates between two kinds of work. **Scripts** are
deterministic and run with no AI. **Reasoning steps** are where a model writes
Midnight-specific code from the repo's references. Every reasoning step ends at
a mechanical gate (compile, devnet tests, typecheck/build). A failure at a gate
loops back to that reasoning step, so code only moves forward once it compiles
and runs.

## Skeleton

```mermaid
flowchart LR
  A(["prompt"]):::io --> B["scaffold"]:::script --> C["reason"]:::reason --> D["UI generator"]:::script --> E["reason"]:::reason --> F(["output"]):::io

  classDef io fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef script fill:#ecfdf5,stroke:#059669,color:#064e3b
  classDef reason fill:#fff7ed,stroke:#ea580c,color:#7c2d12
```

## Flow

```mermaid
flowchart TD
  P(["1 · Prompt<br/>natural-language DApp idea"]):::io
  T["Derive name + flags<br/>kebab-case name, --witnesses?<br/><i>gap: no translator yet</i>"]:::gap
  S["2 · Scaffold<br/>yarn new:example NAME --witnesses"]:::script
  R1["3 · Generate MN-specific code<br/>contract .compact, witnesses.ts, test bodies"]:::reason
  C{"yarn compile, typecheck<br/>pass?"}:::gate
  D["4 · Test on local devnet<br/>yarn validate<br/>compile, env:up, wait:dust, test:local, env:down"]:::script
  G{"test:local<br/>green?"}:::gate
  U["5 · UI generator<br/>yarn new:ui NAME"]:::script
  R2["6 · Add MN-specific UI code<br/>seed files: api.ts, panel.tsx, circuits.test.ts"]:::reason
  B{"typecheck, test:unit, build<br/>new:ui --check"}:::gate
  O(["7 · Serve to user<br/>local Vite dev server"]):::io

  P --> T --> S --> R1 --> C
  C -- "no: fix" --> R1
  C -- yes --> D --> G
  G -- "no: fix" --> R1
  G -- yes --> U --> R2 --> B
  B -- "no: fix" --> R2
  B -- yes --> O
  O -. "iterate: follow-up prompt" .-> R1

  classDef io fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef script fill:#ecfdf5,stroke:#059669,color:#064e3b
  classDef reason fill:#fff7ed,stroke:#ea580c,color:#7c2d12
  classDef gate fill:#f8fafc,stroke:#475569,color:#0f172a
  classDef gap fill:#f1f5f9,stroke:#94a3b8,color:#475569,stroke-dasharray: 4 3
```

Colour key: indigo marks input/output, green a deterministic script, orange a
reasoning (LLM) step, and slate a mechanical gate. Dashed grey marks a step with
nothing behind it yet.

## Steps

| # | Step | Kind | Runs | Reads | Writes | Gate |
|---|------|------|------|-------|--------|------|
| 1 | Prompt | input | — (**gap**: nothing turns a prompt into a scaffold call yet) | User prompt | Example name (kebab-case) and whether it needs witnesses | Name matches `NAME_RE` |
| 2 | Scaffold | script | `yarn new:example <name> [--witnesses] [--no-register]` ([`scripts/new-example.mjs`](../scripts/new-example.mjs)) | [`templates/example/`](../templates/example/) | `examples/<name>/`: contract stub, `src/` harness, test skeleton up to the first `deployContract`, `compose.yml`, `AGENTS.md`. Registers the example in CI and the docs tables | Node 22, `compact` at the CI pin ([`scripts/lib/preflight.mjs`](../scripts/lib/preflight.mjs)); unknown flags rejected; registration succeeded; no leftover template tokens |
| 3 | Generate MN-specific code | reason | Model writes code | See [Context budget](#context-budget): [`compact-gotchas.md`](compact-gotchas.md), [`patterns.md`](patterns.md) and the 1–2 nearest examples | `contract/<name>.compact`, `contract/witnesses.ts`, test bodies in `src/test/<name>.test.ts` | `yarn compile` and `yarn typecheck` pass; on failure, back to 3 |
| 4 | Test on local devnet | script | `yarn validate [--keep-net]` ([`scripts/validate-example.mjs`](../scripts/validate-example.mjs)) = `compile` (if a `.compact` changed) → `env:up` → `wait:dust` → `test:local` → `env:down` | `examples/<name>/compose.yml` (proof server, indexer, node) | Test results; `logs/compose.log` on failure | Exits with the failing step's status; on failure, back to 3. `--keep-net` keeps the network up between fix attempts. **Must pass before step 5** |
| 5 | UI generator | script | `yarn new:ui <name> [--contract <managed-dir>] [--private-state memory\|persistent]` ([`scripts/new-ui.mjs`](../scripts/new-ui.mjs)); preview with `--dry-run` | `contract/managed/<c>/compiler/contract-info.json`, `contract/managed/<c>/contract/index.d.ts`, `contract/witnesses.ts`, `contract/<c>.compact`, and [`templates/ui/`](../templates/ui/) | `examples/<name>/ui/` (Vite + React): template-owned files, seed files, `new-ui.json`, `verification.json` | Refuses when the contract isn't compiled, `ui/` already exists, or `witnesses.ts` lacks a `create<X>PrivateState` factory |
| 6 | Add MN-specific UI code | reason | Model edits seed files only | [`templates/ui/AGENTS.md`](../templates/ui/AGENTS.md) (copied into every `ui/AGENTS.md`); existing `examples/*/ui/` | `src/midnight/<name>-api.ts`, `src/components/<name>-panel.tsx`, `src/__tests__/<name>-circuits.test.ts`, `README.md` | `typecheck`, `test:unit` and `build` pass; `yarn new:ui <name> --check` shows no template drift; on failure, back to 6 |
| 7 | Serve to user | output | `yarn workspace @midnight-ntwrk/example-<name>-ui dev` (runs `copy:zk`, then Vite on :5173); `yarn fund:wallet` funds a browser wallet on devnet | Built UI, managed ZK assets | Running DApp | Browser and Lace checks recorded in `ui/verification.json` |

## Context budget

A reasoning step costs the tokens it reads. Read in this order, and stop once
you have what you need.

| Step | Read | Don't read |
|---|---|---|
| 3 (contract, witnesses, tests) | [`compact-gotchas.md`](compact-gotchas.md) (~1.5K tokens); [`patterns.md`](patterns.md) (~1.5K tokens) to pick the 1–2 nearest examples; in each of those, `contract/*.compact`, `contract/witnesses.ts` and the test bodies (after `Your tests begin here` where present) | `src/wallet.ts`, `src/providers.ts`, `src/config.ts`, `scripts/wait-for-dust.ts`, `compose.yml` (identical in every example); `contract/managed/`; the narrative parts of `TUTORIAL.md` and `LESSONS.md`; examples unrelated to the use case |
| 3, on a gate failure | The failing gate's output first. If `compact-gotchas.md` doesn't explain it, then the `midnight-expert` skills (`compact-core`, `midnight-verify`) or the linked `LESSONS.md`/`TUTORIAL.md` section | All of `TUTORIAL.md` |
| 6 (UI seed files) | [`templates/ui/AGENTS.md`](../templates/ui/AGENTS.md) §3 and §5 and the Gotchas; the nearest `examples/*/ui/` seed files (listed under its "Worked examples") | Template-owned UI files; `examples/zk-loan/ui` (hand-built, not authoritative) |

`yarn compile` and `yarn typecheck` take seconds to a minute; `yarn validate`
takes minutes. Fix everything the cheap gates report before running the
devnet.

## Known gaps and open items

- **Prompt → scaffold (step 1).** Nothing derives the example name and
  `--witnesses` choice from a prompt yet. This is the first reasoning step.
- **No end-to-end runner.** Each step is a separate command, and `yarn validate`
  only covers step 4. Something has to chain steps 2–7 and drive the fix
  loops.
- **No fast tier between compile and devnet.** Contract logic is only tested
  against a devnet (minutes per attempt). An in-memory tier like
  `examples/zk-loan/src/test/zk-loan.simulator.ts` would catch logic errors
  in seconds.
- **Boilerplate the compiler already determines** (witness signatures,
  constructor args, per-circuit test stubs) is still written by the model.
- **Serving (step 7).** Serving stops at the local Vite dev server; there is no
  deploy target in this repo.
- **Browser verification.** The checks in `verification.json` (Lace, browser)
  are run by hand. Decide which of them a pipeline can run automatically before
  serving.

## Changelog

- 2026-10-06: `yarn validate` exits with the failing step's status (it used to
  exit with `env:down`'s, so failing tests passed the gate), compiles first
  when needed, and takes `--keep-net`. Added `typecheck` to every example and
  as a CI step, preflight checks, strict `new:example` flags, and a context
  budget backed by `docs/compact-gotchas.md` and `docs/patterns.md`.
- 2026-10-06: First draft of the 7-step flow (prompt, scaffold, generate,
  devnet test, UI generator, UI code, serve).
