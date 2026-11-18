# AGENTS.md — mn-examples

Instructions for AI agents working in this repository. Humans: see `README.md`.

## What this repo is

A single monorepo of official Midnight examples. Each lives under `examples/<name>`
and is an npm workspace. Shared harness code lives under `packages/`. The whole repo shares one lockfile and one pinned
toolchain (see the version matrix in `README.md`). The point of the monorepo is
that these examples are **verified**: CI compiles every contract and runs its
test suite against a local Midnight network. Treat green examples as ground
truth over your own recollection of Midnight/Compact APIs.

## Golden rules

- **Do not trust memory for Midnight/Compact APIs.** Verify against the compiled
  output and the running tests. Compilation alone is not proof — code must run.
- **The `.compact` source files are committed on purpose.** Only the generated
  `contract/managed/` output is gitignored. Never add a `.gitignore` rule that
  hides `*.compact`.
- **Keep the toolchain pinned.** Do not bump `@midnight-ntwrk/*`, the compiler,
  Node, or npm versions for a single example. Version moves are a coordinated
  repo-wide pass.
- **Leave the root `vite` (6.x, hoisted), `bn.js` (5.2.5) and `uuid` (override)
  pins alone.** Each prevents a real breakage; why is in
  [`docs/dependency-pins.md`](docs/dependency-pins.md).
- **Never commit secrets.** Real `.env.preprod` / `.env.preview` and
  `midnight-level-db/`, `logs/` and `.wallet-state/` (saved wallet sync state)
  are gitignored. Only the `.env.*.example` templates are tracked.
- **Remote suites share four wallets** (Alice/Bob/Charlie/Dave, aliased per
  suite by `resolveWallet` in each example's `src/wallet.ts`). Never run them in
  parallel.
- **`midnight-examples-mirror` is a one-way private copy** (`mirror.yml`
  syncs `main` and twins each non-fork PR as `pr/<number>`). Never push, commit
  or merge there. It runs every workflow it receives, so guard any workflow
  that needs secrets or writes outside this repo with
  `if: github.repository == 'midnightntwrk/midnight-examples'`.

## Common commands

```bash
nvm use                  # Node 22 or newer (.nvmrc pins 22). Shells often default to 20, which the
                         # generators and UI dev/build refuse to run on
npm install -g npm@11                   # npm 11.10+ (Node 22 bundles npm 10, which ignores .npmrc's age gate and rewrites the lockfile)
npm install                             # whole-workspace install (one lockfile)
npm run compile                         # compile all contracts (foreach, parallel)
npm run compile:fast                    # same with --skip-zk: no proving keys, seconds (enough for typecheck and test:sim)
npm run typecheck                       # typecheck every workspace (needs compiled contracts)
npm run test:sim                        # every in-memory test (*.sim.test.ts); no Docker
npm run compile -w @midnight-ntwrk/example-<name>  # one example
npm run new:example -- <name> [--witnesses] [--spec <card.md>]  # phase 1: scaffold an example
npm run new:example -- <name> --derive  # after compile:fast: fill its @generated-stub regions
npm run spec:lint -- <name> [--design]  # SPEC.md alone, then against the compiled contract and sim tests
npm run pipeline -- <name> [--json]     # run the next scripts and gates; prints what to do next
npm run pipeline -- <name> --wait-devnet  # block until the background devnet run finishes
npm run new:ui <name>                   # phase 2: scaffold its browser UI (after the in-memory gate passes)
npm run new:ui -- <name> --check        # template-owned UI files still match packages/mnkit/templates/ui
npm run new:ui -- --sync-all            # after editing packages/mnkit/templates/ui: sync every UI (+ npm install)
npm run new:ui -- --check-all           # CI's drift check for every UI, plus the lockfile check
npm run fund:wallet <mn_dust_…> [mn_addr_…]  # local devnet: DUST (and NIGHT) for a browser wallet
```

Per example (from `examples/<name>`): `npm run compile:fast`, `npm run typecheck` and
`npm run test:sim` (seconds, no Docker), then `npm run validate -- [--keep-net]`
(full compile if stale or keyless → `env:up` → `wait:dust` → `test:local` →
`env:down`, exiting non-zero if any step fails). The steps also run on their
own: `npm run env:up`, `npm run wait:dust`, `npm run test:local`, `npm run env:down`.
Devnet tests require Docker. `npm run pipeline <name>` chains all of it: it runs
the devnet in the background once the in-memory gate passes, and never
compiles while that run holds `.gates/devnet.lock`. Only one devnet runs at a
time (every example binds the same ports).

Remote networks (preprod/preview/custom): `npm run wallets:new`, then
`npm run test:preprod` (every suite, sequentially). Setup and funding are in
[README → Running against a remote network](README.md#running-against-a-remote-network-preprod--preview).

## Examples

Each lives in `examples/<name>`. What each teaches: [README → All
examples](README.md#all-examples). To find the example that shows a technique,
use [`docs/patterns.md`](docs/patterns.md).

Each example has its own `AGENTS.md` with specifics. The order to read them in
for a newcomer is the [Learning path](README.md#learning-path) in the root README.

## Conventions for new/edited examples

- **Before writing Compact, read [`docs/compact-gotchas.md`](docs/compact-gotchas.md)**
  and pick the nearest examples from [`docs/patterns.md`](docs/patterns.md).
  Don't read the whole repo: the harness files are identical in every example.

- **Prefer the generator:** `npm run new:example -- <name> [--witnesses]`
  scaffolds from `packages/mnkit/templates/example/` and registers the example
  in the CI matrix and docs tables; you write `SPEC.md`, the `.compact`, the
  witnesses and the tests. After the first `npm run compile:fast`, `--derive`
  fills the `@generated-stub` regions; it never rewrites a region you have
  edited. The conventions below describe what the template produces.
- **`SPEC.md` first.** Purpose, roles, public ledger fields, private state,
  circuits with their asserts, witnesses, **privacy invariants** ("never on
  chain: …") and **accepted leaks**, out of scope. A human reviews it before
  code exists; keep it in step with the code afterwards. Worked example:
  `examples/private-tip-jar/SPEC.md`.
- **Two kinds of test.** `src/test/*.sim.test.ts` run the compiled contract in
  memory with the example's `src/test/sim.ts` (a copy of `packages/sim`): `Sim.deploy`,
  `sim.call`, `sim.as`, `expectRejects` for every guard, and
  `assertNotInPublicState` with one entry per SPEC privacy invariant.
  `npm run test:sim` runs only these, and CI runs it before starting the network.
  `src/test/<name>.test.ts` is the devnet suite (`npm test` excludes
  `*.sim.test.ts`): keep it to the end-to-end flow. A sim test imports only
  `contract/managed/…` and `contract/witnesses.ts`, never `src/providers.ts` or
  `src/wallet.ts`.
- Directory shape: `contract/` (singular) with the `.compact` source + `index.ts`
  (+ `witnesses.ts` where needed); `src/` for the TypeScript test harness;
  `scripts/` for helpers; `compose.yml` for the local network.
- **Examples import only published `@midnight-ntwrk/*` packages**, so code
  copied out of the repo or the docs installs. Never add a
  `@midnightntwrk/mnkit-{wallet,sim,coins}` dependency or import under
  `examples/`: those are mnkit's runtime packages for standalone projects, and
  CI fails on any mention of them there. Each example carries its own copies
  instead, which the template provides.
- Remote-network wiring lives in `src/wallet.ts`: use its `resolveWallet(network,
  role)` and `waitForNightThenDust(...)`, and add a suite's role names to
  `ROLE_ALIASES`. Never build wallets with testkit's
  `MidnightWalletProvider.build`: it logs the master seed.
- Shielded coins in tests come from `src/test/coins.ts` (a copy of
  `packages/coins`): the token color, `freshCoin(color, value)` for a coin
  argument, balances, mint arguments and `simCoin` for sim tests. Don't copy
  the local helpers in `private-tip-jar`'s or `shielded-chips`' tests. A coin
  argument is a new coin the transaction creates, so never build it from a
  wallet's `availableCoins` (see `docs/compact-gotchas.md`).
- A test-only contract (a token the tests mint from) sits beside the main one
  as `contract/<it>.compact`. The template's compile scripts
  (`scripts/compile-contracts.mjs`) compile every contract, and `--derive`
  wires it.
- A tutorial lives in `tutorials/*.mdx`, starting with `index.mdx` (the
  scaffold copies a stub). This repo is its source of truth: the
  `sync-tutorials` workflow mirrors it into midnight-docs. Open with the
  previous learning-path step, use this repo's commands, never
  `git clone example-*`. See [`docs/tutorials.md`](docs/tutorials.md).
- Extend `../../tsconfig.base.json` in the example `tsconfig.json`.
- Provide `compile`, `compile:fast`, `typecheck`, `test`, `test:sim`,
  `test:local`, `env:up`, `env:down`, `wait:dust` and `validate` scripts so the
  CI matrix and root aggregates work unchanged.
- On a PR, CI runs an example's devnet job only when something under
  `examples/<name>/` or a shared input changed (the `ui` and `mnkit-e2e` jobs
  are gated the same way). The rules are in `scripts/ci-changes.mjs`: if an
  example starts reading a file outside its folder, add that file to `SHARED`.
- A browser frontend is **phase 2**: after the in-memory gate (`typecheck`,
  `test:sim`, `npm run spec:lint`), run `npm run new:ui <name>` (or let
  `npm run pipeline <name>` do it); never hand-copy another UI. Use-case code
  goes in the seed files only, generic changes in `packages/mnkit/templates/ui/`
  (then `--sync`), and checks CI can't run in `ui/verification.json`. The devnet
  must pass before the UI is called done. Details:
  `packages/mnkit/templates/ui/AGENTS.md` (every UI's `ui/AGENTS.md`).
- The scripted generation pipeline (prompt → SPEC → scaffold → contract →
  derive → witnesses and tests → `new:ui` and UI code, with the devnet in the
  background → serve), with each step's gate and fix loop, is in
  `docs/generation-flow.md`; `npm run pipeline <name>` runs it.
- Add meticulous comments in contracts and witnesses explaining the *how* and
  *why* — these examples are read by agents as much as by people.
