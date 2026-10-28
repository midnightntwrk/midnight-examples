# mn-examples

Official Midnight example DApps and smart contracts, consolidated into one
monorepo so that **every example compiles _and_ runs against a single, pinned
toolchain** — and stays that way. These examples are the shared, verified
source that feeds the Midnight docs, the `midnight-expert` skills/MCP tooling,
and the Kapa answer engine. If an example here is green, an agent or a developer
who copies it gets working code.

> Compilation is not correctness. Every example is expected to compile **and**
> execute its test suite against a local Midnight network in CI.

## Learning path

New to Midnight? Work through these examples in order. Each one builds on the
step before it. Each tutorial lives in the example's `tutorials/` folder and is
published on [docs.midnight.network](https://docs.midnight.network/tutorials)
(see [`docs/tutorials.md`](./docs/tutorials.md)).

| # | Example | Teaches |
|---|---|---|
| 1 | [`hello-world`](./examples/hello-world) | Environment smoke test: a minimal contract, the test harness, devnet and fast-sync wallets |
| 2 | [`private-bid`](./examples/private-bid) | First real contract: prove a bid meets a sealed minimum without revealing it, commit and reveal, the minimal `disclose()` boundary |
| 3 | [`battleship`](./examples/battleship/tutorials/index.mdx) | Defensive programming: a state machine, role checks, and on-chain verification of off-chain data that catches cheating |
| 4 | [`private-tip-jar`](./examples/private-tip-jar) | Two contracts (jar and tip token), still simple; a first shielded token: anonymous tips into a contract-held pot |
| 5 | [`shielded-chips`](./examples/shielded-chips) | Complex shielded token integration: a native shielded token, contract custody and payout, and the privacy trade-offs between variations |
| 6 | [`zk-loan`](./examples/zk-loan/tutorials/index.mdx) | Real use case: private credit scoring against a signed attestation from an off-chain API |
| 7 | [`midnight-leaderboard`](https://github.com/midnightntwrk/midnight-leaderboard) | Deploying a DApp to Vercel |

## Layout

```
mn-examples/
├── examples/
│   ├── hello-world/      # environment smoke test + minimal contract/test suite + browser UI (ui/)
│   ├── calculator/       # public ledger value + arithmetic circuits + a divMod witness + browser UI (ui/)
│   ├── private-party/    # private on-chain data, access control, DUST sponsorship + browser UI (ui/)
│   ├── token-transfers/  # mint/send/receive for unshielded, NIGHT, and shielded tokens + browser UI (ui/)
│   ├── silent-auction/   # sealed reserve price (commit-reveal), NFT auction state machine
│   ├── election/         # two-candidate vote: register, commit a hashed vote, reveal and count
│   ├── secret-message/   # private message: publish a hash commitment, not the plaintext
│   ├── zk-loan/   # private credit scoring: verify a signed attestation in-circuit, disclose only the outcome
│   ├── shielded-chips/   # shielded tokens: MIP-0011 chips + a roulette that custodies and pays out coins privately
│   ├── private-bid/      # private bid: prove bid >= a public minimum, store only a commitment, reveal later
│   ├── private-tip-jar/  # anonymous shielded tips into a contract-held pot; only the owner can withdraw
│   └── battleship/       # Compact contract as a state machine, RBAC, private state + browser UI (ui/)
├── packages/
│   ├── mnkit/            # the scaffolder: engine, CLI and templates/example (copied by `npm run new:example`)
│   ├── fast-sync/        # @midnight-ntwrk/mnkit-wallet: wallet provider, pre-seed fast sync, .env seeds, funding gate
│   ├── sim/              # @midnight-ntwrk/mnkit-sim: in-memory contract harness for *.sim.test.ts
│   └── coins/            # @midnight-ntwrk/mnkit-coins: shielded-coin helpers for tests
├── preseed/              # pre-seed reference bundles, per network
├── toolchain.json        # the one toolchain pin (`npm run toolchain:check`)
├── packages/mnkit/templates/ui/         # browser UI scaffold rendered by `npm run new:ui`
├── tsconfig.base.json    # shared TypeScript compiler options
├── vitest.config.ts      # aggregate test projects (per-example configs still own env)
└── .github/workflows/    # CI: compile-and-run every example on a matrix
```

Each example is an npm workspace and remains independently runnable.

## Pinned toolchain (Phase 1 baseline)

All Phase 1 examples are frozen on one generation. Do not bump these piecemeal;
version changes happen in a coordinated pass. The pins live in
[`toolchain.json`](toolchain.json): change them there first, then run
`npm run toolchain:check`, which fails until this table, `ci.yaml`, `.nvmrc`, every
`compose.yml`, `package.json` and contract pragma agree.

| Component | Version |
|---|---|
| Compact language (`pragma`) | `0.23` |
| Compact compiler (`setup-compact-action`) | `0.31.1` |
| `@midnight-ntwrk/midnight-js-*` | `4.1.1` |
| `@midnight-ntwrk/testkit-js` | `4.1.1` |
| wallet SDK | `1.2.0` |
| Node.js | `22` (see `.nvmrc`) |
| npm | `11.21.0` (CI; `11.10.0` or newer locally) |
| Vitest | `5.0.4` |
| Vite | `6.4.4` |

## Prerequisites

- **Node.js 22** (`nvm use`).
- **npm 11.10 or newer.** Node 22 bundles npm 10. It can `npm ci` this
  lockfile, but it silently ignores the 7-day release-age gate in `.npmrc`,
  and its `npm install` strips the lockfile's `libc` entries:
  `npm install -g npm@11`. (`package.json` `devEngines` warns on an older npm,
  and the repo scripts that write the lockfile refuse one.)
- **Docker** (the examples spin up a local Midnight network via `docker compose`).
- **Compact compiler** on `PATH` (`compact`); CI installs it via `setup-compact-action`.

## Getting started

```bash
npm install      # one lockfile for the whole workspace
npm run compile  # compile every example's contract (parallel)
```

Flags for a script go after `--`, or npm takes them as its own options:
`npm run new:ui -- <name> --check`.

Run a single example end-to-end (compile is already done above):

```bash
cd examples/battleship
npm run env:up      # start the local Midnight network (Docker)
npm run wait:dust   # wait for DUST to accrue for fees
npm run test:local  # run the test suite against the local network
npm run env:down
```

Run every example's tests from the root:

```bash
npm run test:local       # npm run test:local --workspaces --if-present
```

## Running against a remote network (preprod / preview)

The examples also run against the public **preprod** and **preview** networks. A
local proof server is still required; everything else is remote.

The obstacle is wallet sync: a brand-new wallet on preprod takes **~78 minutes** to
reach chain tip, almost all of it building the chain-wide DUST generation tree. The
repo ships **pre-seed reference bundles** under `preseed/` that a fresh wallet
restores from instead, bringing that down to about **75 seconds**. See
[FAST-SYNC.md](./FAST-SYNC.md).

```bash
cd examples/hello-world && npm run proof:up   # local proof server on :6300
cd ../..

npm run preseed:cut  # 1. re-cut the reference bundle       (~10 min)
npm run wallets:new  # 2. mint 4 wallets, print 4 addresses
#                      3. fund those addresses at the faucet (manual)
npm run test:preprod    # 4. run every suite, sequentially
```

**Step 1 must come before step 2** — a bundle cut after the wallets exist cannot
be used to seed them, and every run silently falls back to the 78-minute sync.
FAST-SYNC.md explains why.

`npm run wallets:new` writes a repo-root `.env.preprod` (gitignored) holding four
seeds — **Alice, Bob, Charlie and Dave** — and prints their addresses for the
[faucet](https://midnight-tmnight-preprod.nethermind.dev/). One file serves all
eight examples; suites with other role names (silent-auction's
`ORGANIZER`/`BIDDER_ONE`/`BIDDER_TWO`) alias onto the same four wallets. Copy
`.env.preprod.example` instead if you want to supply your own.

Alice, Bob and Charlie need tNIGHT and the suites register them for DUST
automatically on first run. **Dave needs tNIGHT and nothing else** — the DUST
sponsorship suite in `private-party` exists to demonstrate Alice paying his fees,
and asserts that he has no DUST of his own.

> Keep remote runs **sequential**. All eight suites share the same four wallets,
> and concurrent spends of the same UTxOs produce nondeterministic balancing
> failures. The root `test:preprod` script is sequential by design.

## Adding / working with examples

- **Scaffold a new example with `npm run new:example -- <name> [--witnesses]`.** It
  copies `packages/mnkit/templates/example/` into `examples/<name>`, wires the
  harness, and registers the example in the CI matrix and the docs tables. You
  then only write the `.compact` contract and the test bodies. See
  `packages/mnkit/templates/example/`.
- **Add a browser UI with `npm run new:ui <name>`** once the contract compiles and
  its tests pass. It renders `packages/mnkit/templates/ui/` into `examples/<name>/ui`, deriving
  circuits, witnesses and ledger fields from the compiled contract, so the UI
  typechecks, tests and builds before any use-case code is written. See
  `packages/mnkit/templates/ui/AGENTS.md` (copied into every generated UI).
- The scripted generation pipeline (prompt, scaffold, generate, devnet test, UI
  generator, UI code, serve) is drawn in [`docs/generation-flow.md`](./docs/generation-flow.md).
- The `.compact` **source is committed** (only generated `contract/managed/` output is
  gitignored). Do not re-introduce a `.gitignore` rule that hides `*.compact`.
- Each example carries an `AGENTS.md` describing what it teaches and how to run it.
- See `AGENTS.md` at the repo root for agent-oriented conventions.

## mnkit: the scaffolder, outside this repo

[`packages/mnkit`](packages/mnkit/README.md) is the same engine packaged as an
npm CLI (`npx mnkit init my-app`) that scaffolds a standalone project around a
developer's own contract. `npm run new:example` is its monorepo mode; `mnkit init`
renders the same template as a plain npm project. Its runtime libraries are
`packages/fast-sync` (`@midnight-ntwrk/mnkit-wallet`), `packages/sim` and
`packages/coins`, all versioned with mnkit.

- `npm run test:engine`: the engine's unit tests, over committed compiler output
  (`npm run fixtures:regen -- --check` keeps it current).
- `bash scripts/mnkit-e2e.sh [--devnet]`: packs the four packages and runs the packed
  CLI in a directory outside the repo, the way a user gets it (CI: `mnkit-e2e`).
- `bash scripts/mnkit-rehearsal.sh`: publishes them to a throwaway local registry and
  tests `npx mnkit@<version>` from it, before a real release.
- Releases: `.github/workflows/release-mnkit.yml`, on a GitHub release tagged
  `mnkit-v<version>` from a commit on `main`. The publish waits for approval in
  the `npm-publish` environment. A pre-release goes to the `next` dist-tag; a
  re-run skips packages already published at that version.

## License

Apache-2.0. See [LICENSE](./LICENSE).
