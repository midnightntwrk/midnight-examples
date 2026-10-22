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
- **The hoisted `vite` is 6.x, set by `examples/zk-loan/ui`.** That UI uses
  upstream's Vite 6 toolchain, and npm hoists it to the root, so every
  example's `vitest.config.ts` gets Vite 6.4.3 for its bare `import { loadEnv }
  from 'vite'`. vitest itself still runs on its own nested Vite 8. This is
  intentional for now: containing Vite 6 to the UI breaks it (see
  `examples/zk-loan/ui/README.md`). Do not "fix" it by pinning Vite 8 at the
  root. The Vite 8 move is a TODO for the next coordinated version pass.
- **The root `devDependencies` pins `bn.js` 5.2.5 on purpose.** It anchors a
  single `bn.js@5` at `node_modules/`. Without it, the `zk-loan/ui` browser
  polyfills (`vite-plugin-node-polyfills` → `crypto-browserify` → `elliptic`,
  `asn1.js`, …) hoist `bn.js@4` to the root, the wallet SDK's node client and
  `@polkadot/util` each get a private `bn.js@5` copy, and every transaction
  submit fails with `SubmissionError` (`blockNumber: Expected BN, actual N`)
  even though the tx lands, followed by `DustDoubleSpend` on the next one. Do
  not remove it; `bn.js@4` stays nested under the polyfill packages.
- **The root `overrides` pin `vite-plugin-top-level-await` → `uuid` to 11.1.1
  on purpose.** The plugin (1.6.0, latest) pins `uuid` exactly at 10.0.0,
  which Trivy flags (CVE-2026-41907, fixed in 11.1.1). It only calls
  `require("uuid").v5`, which 11.x keeps. Drop the override once the plugin
  widens its range.
- **Never commit secrets.** Real `.env.preprod` / `.env.preview` and
  `midnight-level-db/`, `logs/`, wallet preseed state are gitignored. Only the
  `.env.*.example` templates are tracked. The `preseed/` bundles ARE committed on
  purpose — they hold public chain state and a public key that gets replaced on
  restore, no secret.
- **Never hand-write a `_BIRTHDAY` line in a `.env.<network>`.** It is what
  authorizes pre-seeding a wallet, and only `npm run wallets:new` — which reads the
  chain tip as it mints the seed — can state it truthfully. Adding one next to a
  pre-existing wallet defeats the `isSeedable()` guard and silently hides that
  wallet's funds. Omitting it is always safe: that wallet just does a full sync.
- **Remote suites share four wallets** (Alice/Bob/Charlie/Dave, aliased per
  suite in `packages/fast-sync/src/resolve.ts`). Never run them in parallel.

## Common commands

```bash
nvm use                  # Node 22 (.nvmrc). Shells often default to 20, which the
                         # generators and UI dev/build refuse to run on
npm install -g npm@11                   # npm 11.10+ (Node 22 bundles npm 10): the lockfile and .npmrc's age gate need it
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

Against a remote network (preprod/preview) — see `FAST-SYNC.md`:

```bash
npm run preseed:cut   # re-cut the pre-seed reference bundle. ALWAYS BEFORE wallets:new
npm run wallets:new   # mint the 4 shared wallets into a repo-root .env.<network>
npm run test:preprod  # every suite, sequentially (they share those wallets)
```

## Examples

| Example | Teaches |
|---|---|
| `hello-world` | Environment smoke test; minimal contract + test harness; zero-setup fast-sync wallet; browser frontend (`ui/`: wallet connect, deploy/join, live ledger, wallet or local proving) |
| `calculator` | Public `ledger` value updated by arithmetic circuits; a `divMod` witness verified on-chain (verify-off-chain-work pattern); browser frontend (`ui/`, generated by `npm run new:ui`: witness run in the browser, operand pre-checks tested against the real circuits) |
| `private-party` | Private on-chain data, access control, unshielded (NIGHT), DUST sponsorship; browser frontend (`ui/`, generated by `npm run new:ui`: secret kept in encrypted private state and passed as a circuit argument, wallet address as `UserAddress`, organizer/guest actions pre-checked against the real circuits) |
| `battleship` | Compact contract as a state machine, role-based access control, private state, on-chain verification of off-chain data; browser frontend (`ui/`, generated by `npm run new:ui`: two-player game, encrypted persistent private state behind a passphrase, seat found via a pure circuit, cheat checks tested against the real circuits) |
| `token-transfers` | Unshielded tokens (`mintUnshieldedToken`, `sendUnshielded`, `receiveUnshielded`, NIGHT as `default<Bytes<32>>`) and shielded Zswap coins (`mintShieldedToken`, `sendShielded`, `receiveShielded`); a contract with no ledger, observed through wallet balances; browser frontend (`ui/`, generated by `npm run new:ui`: wallet balances instead of a ledger readout, a shielded-coin picker fed by earlier results, mint nonces built in code, circuit `Effects` tested in memory) |
| `silent-auction` | Commit-reveal of a hidden reserve price (`persistentCommit` in the constructor), `sealed` ledger fields, an `AuctionState` state machine, organizer/bidder keys derived from a witness secret, unshielded flows (NIGHT deposit, `mintUnshieldedToken` NFT, `sendUnshielded` settlement), raise-only bids in a `Map` |
| `election` | Commit-reveal voting: voters register a witness-derived key in a `Set`, commit `persistentHash(vote, sk)` into a `Map` while voting is open, then reveal against it once closed; `Set` guards against double votes and double reveals; `Counter` tallies; `sealed` organizer and candidates; a `VotingState` state machine |
| `secret-message` | Private on-chain data via hashing: a witness supplies a secret, the circuit publishes only its `persistentHash` commitment |
| `zk-loan` | Private credit scoring: an in-circuit Schnorr/Jubjub signature check on a witness-supplied profile, witness-derived identity (no `ownPublicKey()`), nested `Map`s, batched migration |
| `shielded-chips` | Shielded tokens end to end: a MIP-0011 native shielded token (mint, both burn paths) plus a roulette contract that custodies and pays out coins; commitment-based escrow and `mergeCoin` ordering keep coin nonces (and so wallets) off chain; two contracts wired from one harness; browser frontend (`ui/`, generated by `npm run new:ui -- --contract roulette`: the chips token wired as a second contract via `providersFor`, fresh coins as `receiveShielded` arguments, the escrow's Merkle index recovered from the indexer, house and player in separate browser profiles) |
| `private-bid` | The docs guide "How to build a private smart contract": prove a bid meets a public `sealed` minimum without revealing it, store a salted `persistentCommit` under a hashed, contract-bound bidder key (`kernel.self()`), reveal later; the minimal `disclose()` boundary |
| `private-tip-jar` | Anonymous shielded tips into a contract-held pot: each tip is a fresh coin (random nonce, `freshCoin` from `packages/coins`) the tipper's wallet pays for, stored with `insertCoin` behind a duplicate-key guard (no wallet coin nonce reaches `pot`; tip values stay public), owner-only `withdraw` gated by a hashed witness key, a demo faucet token minted for the tests, a privacy test over the public ledger |

Each example has its own `AGENTS.md` with specifics. The order to read them in
for a newcomer is the [Learning path](README.md#learning-path) in the root README.

## Conventions for new/edited examples

- **Before writing Compact, read [`docs/compact-gotchas.md`](docs/compact-gotchas.md)**
  and pick the nearest examples from [`docs/patterns.md`](docs/patterns.md).
  Don't read the whole repo: the harness files are identical in every example.

- **Prefer the generator:** `npm run new:example -- <name> [--witnesses]` scaffolds a
  new example from `packages/mnkit/templates/example/` (harness, config, compose, a `SPEC.md`
  design card, docs stubs, an in-memory test and a devnet test skeleton) and
  registers it in the CI matrix + docs tables. Author writes `SPEC.md`, the
  `.compact`, the witnesses and the tests. After the first `npm run compile:fast`,
  `npm run new:example -- <name> --derive` fills the `@generated-stub` regions from
  the compiled contract (witness stubs, constructor `args`, an `it.todo` per
  circuit, the ledger fields). It only rewrites a region whose body still
  matches the `sha=` in its begin marker, so edit a region freely: from then on
  it is yours. Delete the markers too if you like. The conventions below
  describe what that template produces.
- **`SPEC.md` first.** Purpose, roles, public ledger fields, private state,
  circuits with their asserts, witnesses, **privacy invariants** ("never on
  chain: …") and **accepted leaks**, out of scope. A human reviews it before
  code exists; keep it in step with the code afterwards. Worked example:
  `examples/private-tip-jar/SPEC.md`.
- **Two kinds of test.** `src/test/*.sim.test.ts` run the compiled contract in
  memory with `@midnight-ntwrk/mnkit-sim` (`packages/sim`): `Sim.deploy`,
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
- Remote-network wiring is shared, not copied: depend on
  `@midnight-ntwrk/mnkit-wallet` and use its `resolveWallet(network, role)`
  and `waitForNightThenDust(...)` rather than writing a per-example seed resolver.
  `vitest.config.ts` loads `.env.<network>` from the REPO ROOT via `loadEnv`.
- Shielded coins in tests are shared too: `@midnight-ntwrk/mnkit-coins`
  (`packages/coins`) has the token color, `freshCoin(color, value)` for a coin
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
- Adding a browser frontend is **phase 2**: once the in-memory gate passes
  (`typecheck`, `test:sim`, `npm run spec:lint`), run `npm run new:ui <name>`, or let
  `npm run pipeline <name>` do it. The devnet runs in the background meanwhile and
  must pass before the UI is called done. Don't hand-copy
  `hello-world/ui`. The generator reads `contract-info.json` and writes a UI
  that already typechecks, tests and builds. Put use-case code only in the seed
  files: `src/midnight/<name>-api.ts`, `src/components/<name>-panel.tsx` and
  `src/__tests__/<name>-circuits.test.ts`. Record the checks CI can't run
  (browser, wallet, preprod) in `ui/verification.json`; `--check` keeps
  `packages/mnkit/templates/ui/VERIFIED.md` in step with it, and it is the only place that
  says what a UI has been verified to do. Generic UI changes go in
  `packages/mnkit/templates/ui/`, followed by `npm run new:ui -- <name> --sync`; CI runs `--check` on
  every generated UI. Details, pins and the verification checklist are in
  `packages/mnkit/templates/ui/AGENTS.md`, which every generated UI carries as `ui/AGENTS.md`.
- The scripted generation pipeline (prompt → SPEC → scaffold → contract →
  derive → witnesses and tests → `new:ui` and UI code, with the devnet in the
  background → serve), with each step's gate and fix loop, is in
  `docs/generation-flow.md`; `npm run pipeline <name>` runs it.
- Add meticulous comments in contracts and witnesses explaining the *how* and
  *why* — these examples are read by agents as much as by people.
