# mn-examples

Official Midnight example DApps and smart contracts, consolidated into one
monorepo so that **every example compiles _and_ runs against a single, pinned
toolchain** — and stays that way. These examples are the shared, verified
source that feeds the Midnight docs, the `midnight-expert` skills/MCP tooling,
and the Kapa answer engine. If an example here is green, an agent or a developer
who copies it gets working code.

> Compilation is not correctness. Every example is expected to compile **and**
> execute its test suite against a local Midnight network in CI.

Everything here targets **Ledger 9** (the pins are in
[Pinned toolchain](#pinned-toolchain)).

## Learning path

New to Midnight? Work through these examples in order. Each one builds on the
step before it. Each tutorial lives in the example's `tutorials/` folder and is
published on [docs.midnight.network](https://docs.midnight.network/tutorials)
(see [`docs/tutorials.md`](./docs/tutorials.md)).

| # | Example | Teaches |
|---|---|---|
| 1 | [`hello-world`](./examples/hello-world) | Environment smoke test: a minimal contract, the test harness, devnet and a zero-setup test wallet |
| 2 | [`private-party`](./examples/private-party/tutorials/index.mdx) | First real contract: the privacy boundary. Guests RSVP privately with a salted commitment, then become public when they pay the unshielded NIGHT entry fee; a DApp-specific key gates the organizer's actions |
| 3 | [`battleship`](./examples/battleship/tutorials/index.mdx) | Defensive programming: a state machine, role checks, and on-chain verification of off-chain data that catches cheating |
| 4 | [`private-tip-jar`](./examples/private-tip-jar/tutorials/index.mdx) | Two contracts (jar and tip token), still simple; a first shielded token: anonymous tips into a contract-held pot |
| 5 | [`shielded-chips`](./examples/shielded-chips) | Complex shielded token integration: a native shielded token, contract custody and payout, and the privacy trade-offs between variations |
| 6 | [`zk-loan`](./examples/zk-loan/tutorials/index.mdx) | Real use case: private credit scoring against a signed attestation from an off-chain API |
| 7 | [`leaderboard`](./examples/leaderboard/tutorials/index.mdx) | A browser DApp with Lace, deployed to Vercel |

## All examples

Every example has its own `README.md` and `AGENTS.md`, a simulator suite
(`npm run test:sim`) and a devnet suite (`npm run test:local`).

| Example | Teaches | Extras |
|---|---|---|
| [`hello-world`](./examples/hello-world) | Environment smoke test: a minimal contract, the test harness, devnet and a zero-setup test wallet | browser UI |
| [`calculator`](./examples/calculator) | A public ledger value updated by arithmetic circuits, plus a `divMod` witness | browser UI |
| [`private-party`](./examples/private-party) | Private on-chain data, access control and DUST sponsorship | browser UI, tutorial |
| [`token-transfers`](./examples/token-transfers) | Minting and sending unshielded, NIGHT and shielded tokens | browser UI |
| [`battleship`](./examples/battleship) | A contract as a state machine, role checks and private state | browser UI, tutorial |
| [`silent-auction`](./examples/silent-auction) | A sealed reserve price (commit-reveal) in an NFT auction state machine | |
| [`secret-message`](./examples/secret-message) | Publishing a hash commitment instead of the plaintext | |
| [`private-bid`](./examples/private-bid) | Proving a bid meets a public minimum, storing only a commitment, revealing later | |
| [`private-tip-jar`](./examples/private-tip-jar) | Anonymous shielded tips into a contract-held pot that only the owner can withdraw | tutorial |
| [`shielded-chips`](./examples/shielded-chips) | MIP-0011 shielded chips and a roulette that custodies and pays out coins privately | browser UI |
| [`zk-loan`](./examples/zk-loan) | Verifying a signed credit attestation in-circuit and disclosing only the outcome | browser UI, tutorial |
| [`leaderboard`](./examples/leaderboard) | Structured on-chain data and ownership proofs in a browser DApp that uses Lace, deployed to Vercel | browser UI, tutorial |
| [`voting`](./examples/voting) | Anonymous allow-listed voting: Merkle membership, nullifiers and admin-counted encrypted ballots | CLI (`npm run vote`) |

## Layout

```
mn-examples/
├── examples/<name>/       # one npm workspace per example (see All examples)
├── packages/
│   ├── mnkit/            # the scaffolder: engine, CLI and templates/example (copied by `npm run new:example`)
│   │   └── templates/ui/ # browser UI scaffold rendered by `npm run new:ui`
│   ├── fast-sync/        # @midnightntwrk/mnkit-wallet: wallet provider, saved wallet state, .env seeds, funding gate
│   ├── sim/              # @midnightntwrk/mnkit-sim: in-memory contract harness for *.sim.test.ts
│   └── coins/            # @midnightntwrk/mnkit-coins: shielded-coin helpers for tests
├── experimental/q2-ledger9/ # Q2 2026 stagenet suites and the Ledger 9 compatibility matrix
├── docs/                 # tutorials sync, Compact patterns and gotchas, the generation flow
├── scripts/              # repo tooling: compile, toolchain check, scaffolders, CI path rules
├── preseed/              # Ledger 8 pre-seed bundles; pre-seeding is off on Ledger 9 (FAST-SYNC.md)
├── toolchain.json        # the one toolchain pin (`npm run toolchain:check`)
├── tsconfig.base.json    # shared TypeScript compiler options
├── vitest.config.ts      # aggregate test projects (per-example configs still own env)
└── .github/workflows/    # CI: compile-and-run every example on a matrix
```

Each example is an npm workspace and remains independently runnable.

## Pinned toolchain

All examples are frozen on one generation. Do not bump these piecemeal;
version changes happen in a coordinated pass. The pins live in
[`toolchain.json`](toolchain.json): change them there first, then run
`npm run toolchain:check`, which fails until this table, `ci.yaml`, `.nvmrc`, every
`compose.yml`, `package.json` and contract pragma agree.

| Component | Version |
|---|---|
| Compact language (`pragma`) | `0.28` |
| Compact compiler (`setup-compact-action`) | `0.36.0` |
| `@midnight-ntwrk/midnight-js-*` | `5.0.0` |
| `@midnight-ntwrk/midnight-js-network-id` | `5.0.0-rc.5` (no 5.0.0 published) |
| `@midnight-ntwrk/testkit-js` | `5.0.0` |
| wallet SDK | `2.0.0` |
| Node.js | `22` (see `.nvmrc`) |
| npm | `11.21.0` (CI; `11.10.0` or newer locally) |
| Vitest | `5.0.4` |
| Vite | `6.4.4` |
| Compact CLI (`compact`) | `0.5.3` |
| `@midnight-ntwrk/dapp-connector-api` | `4.0.1` |
| proof server image | `9.0.0` |
| node image (local devnet) | `2.1.101` |
| indexer image (local devnet) | `4.4.101` |

`npm run toolchain:check` compares this table's compiler, language, SDK, Node,
npm, Vitest and Vite rows with `toolchain.json`, and the image pins with every
`compose.yml`. The other rows are copied from `toolchain.json` by hand.

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

Preprod is served through **Blockfrost**, so it also needs a Blockfrost project
ID in `BLOCKFROST_PROJECT_ID`. Put it in the repo-root `.env.preprod` for the test
suites; export it in your shell for `npm run wallets:new`, which doesn't read the
file. Preview needs no key.

The examples' wallets are built with `@midnight-ntwrk/testkit-js`. Every example
except `leaderboard` turns on the wallet SDK's `skipLedgerV8DustHistory`, so a new
wallet's first sync skips the Ledger 8 DUST history (on preprod about 6 minutes
instead of about 70). After
each sync, a wallet's state is saved to the gitignored `.wallet-state/` and the
next run syncs only the gap (`MIDNIGHT_WALLET_STATE=off` turns this off). The
pre-seed fast sync described in [FAST-SYNC.md](./FAST-SYNC.md) is disabled on
Ledger 9.

```bash
cd examples/hello-world && npm run proof:up   # local proof server on :6300
cd ../..

npm run wallets:new  # 1. mint 4 wallets, print 4 addresses
#                      2. fund those addresses at the faucet (manual)
npm run test:preprod    # 3. run every suite, sequentially
```

For preview, prefix the first step with `MIDNIGHT_NETWORK=preview` (it writes
`.env.preview`), fund at the
[preview faucet](https://midnight-tmnight-preview.nethermind.dev/), and run
`npm run test:preview`.

`npm run wallets:new` writes a repo-root `.env.preprod` (gitignored) holding four
seeds — **Alice, Bob, Charlie and Dave** — and prints their addresses for the
[faucet](https://midnight-tmnight-preprod.nethermind.dev/). One file serves every
example; suites with other role names (silent-auction's
`ORGANIZER`/`BIDDER_ONE`/`BIDDER_TWO`) alias onto the same four wallets. Copy
`.env.preprod.example` instead if you want to supply your own.

Alice, Bob and Charlie need tNIGHT and the suites register them for DUST
automatically on first run. **Dave needs tNIGHT and nothing else** — the DUST
sponsorship suite in `private-party` exists to demonstrate Alice paying his fees,
and asserts that he has no DUST of his own.

> Keep remote runs **sequential**. All the suites share the same four wallets,
> and concurrent spends of the same UTxOs produce nondeterministic balancing
> failures. The root `test:preprod` script is sequential by design.

### Custom network

To run against a network that isn't built in, such as a private test network,
copy `.env.custom.example` to `.env.custom` (gitignored). Fill in the network ID,
the node and indexer URLs (HTTP and WebSocket), and four wallet seeds, then run
`npm run test:custom`. The run stops with one error that lists any missing
endpoint. The suites print any address that still needs funding.

If the endpoints change partway through, such as at a hard fork, keep the seeds in
`.env.custom` and put each endpoint set in its own file. Pick one per run with
`MIDNIGHT_ENV_FILE`:

```bash
MIDNIGHT_ENV_FILE=.env.custom.prefork  npm run test:custom
MIDNIGHT_ENV_FILE=.env.custom.postfork npm run test:custom
```

The same rule applies here: run one suite at a time.

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
- On a pull request, CI runs an example's job only when the change can affect that
  example. The path rules live in [`scripts/ci-changes.mjs`](scripts/ci-changes.mjs).
- See `AGENTS.md` at the repo root for agent-oriented conventions.

## mnkit: the scaffolder, outside this repo

[`packages/mnkit`](packages/mnkit/README.md) is the same engine packaged as an
npm CLI (`npx mnkit init my-app`) that scaffolds a standalone project around a
developer's own contract. `npm run new:example` is its monorepo mode; `mnkit init`
renders the same template as a plain npm project. Its runtime libraries are
`packages/fast-sync` (`@midnightntwrk/mnkit-wallet`), `packages/sim` and
`packages/coins`, all versioned with mnkit. Standalone projects depend on them.
The examples in this repo, and examples scaffolded by `npm run new:example`,
carry their own copies instead (`src/wallet.ts`, `src/test/sim.ts`,
`src/test/coins.ts`), so their code imports only published `@midnight-ntwrk/*`
packages. CI fails if anything under `examples/` names a runtime package.

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
