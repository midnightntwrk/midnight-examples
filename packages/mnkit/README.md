# mnkit

**Write your Midnight contract; mnkit writes everything around it.**

`mnkit` scaffolds a Midnight project around a Compact contract you write: a
pinned local network, wallet and providers, an in-memory test harness and a
devnet test suite. Once the contract compiles, `mnkit derive` reads the
compiler's output and fills in the code that depends on it: typed witness
stubs, constructor arguments, a test per circuit, and the wiring for a second
contract. Run it again after every contract change; it never touches code you
wrote.

Looking for example code instead? Clone
[midnight-examples](https://github.com/midnightntwrk/midnight-examples). Its
examples are built with this same engine.

## Requirements

- Node.js 22 or later
- Docker, for the local network
- The [Compact CLI](https://docs.midnight.network/getting-started/installation)
  (`compact`) and the compiler version mnkit pins. You don't have to install
  either: the first `npm run compile` installs what's missing (the CLI to
  `~/.local/bin`, the compiler to `~/.compact`). It doesn't change your default
  compiler; if you have none, the pinned one becomes it. `--no-install` or
  `MNKIT_NO_INSTALL=1` turns that off.
- Linux or macOS. On Windows, use WSL.

## Quickstart

```bash
npx mnkit init my-app          # add --witnesses if your contract will declare witnesses
cd my-app
npx mnkit doctor               # Node, Docker, the Compact compiler, free ports
```

Write your contract in `contract/my-app.compact` (`SPEC.md` is a design card
to fill in first, if you like), then:

```bash
npm run compile:fast           # compile without proving keys: seconds
npx mnkit derive               # witness stubs, constructor args, a test per circuit
```

Fill in the `TODO`s that `derive` left: witness bodies, constructor
arguments, and the `it.todo` tests. Then:

```bash
npm run typecheck && npm run test:sim   # in-memory tests: no network, no proofs
npm run validate                        # compile, local network, DUST, devnet tests
```

`validate` starts the local network (`compose.yml`), waits until the test
wallet has DUST for fees, runs the devnet suite and takes the network down.
`npm run validate -- --keep-net` leaves it running between fix-and-retry runs.

### Add a browser UI

```bash
npm run compile                # the UI needs the proving keys, so not compile:fast
npx mnkit add ui               # ui/: wallet connect, deploy/join, ledger view, a form per circuit
npm run dev --workspace ui     # http://localhost:5173, against the local network
```

`add ui` runs `typecheck` and `test:sim` first and refuses if they fail. The
UI is an npm workspace of the project, so one `npm install` covers both. Its
seed files (`ui/src/midnight/<name>-api.ts`, `ui/src/components/<name>-panel.tsx`
and the circuits test) are yours to build on; `ui/AGENTS.md` says which files
are which and has a verification checklist. On the local network, give your
browser wallet DUST with `npm run fund:wallet <mn_dust_…> [mn_addr_…]`: the
page prints the command, with your addresses, while the wallet has none.

### Add another contract

```bash
npx mnkit add contract my-token   # contract/my-token.compact
npm run compile:fast && npx mnkit derive
```

`derive` wires every extra contract into `contract/index.ts` and the devnet
suite (a deploy test each). One with witnesses it lists for you to wire by
hand.

### Deploy without the UI

```bash
npx mnkit deploy                        # local (env:up and wait:dust first)
npx mnkit deploy --network preprod      # or preview: the wallet in .env.preprod
npx mnkit deploy my-token               # another contract, before one that needs its address
```

`deploy` runs the project's `scripts/deploy.ts` and records the address and tx
in `deployments/<network>.json`. Commit the preview and preprod files; the local
one is gitignored. The constructor arguments and initial private state come
from `contract/deploy-args.ts`, which is yours and which `derive` fills with
placeholders. The private state and the contract's signing key are kept,
encrypted with `MIDNIGHT_PRIVATE_STATE_PASSWORD` (required off local), in
`.mnkit/private-state/<network>`. Mainnet is not supported.

### Upgrade

```bash
npm install --save-dev mnkit@latest && npx mnkit upgrade
```

`upgrade` moves the project to that mnkit's templates and pinned toolchain.
mnkit.json records a hash of every file the template owns, so `upgrade` can
tell what you changed:

- a file only the template changed is replaced
- a file only you changed is left alone
- a file you both changed keeps your version, and the new one is written next
  to it as `<file>.mnkit-new` for you to merge (`--force` replaces it). Until
  you delete the `.mnkit-new` the file counts as unmerged and `--check` fails;
  after that, your merge counts as your edit of the new version
- a file you deleted stays deleted (`--force` restores it)

`package.json` (and `ui/package.json`) are merged: the pinned packages move to
the new versions, new dependencies and scripts are added, and your own
dependencies and scripts stay. `npx mnkit upgrade --check` reports what would
change and exits 1 if the project is behind, for CI. Every mnkit command exits
2 on an error, so 1 always means "behind".

## What you get

| Path | What it is |
|---|---|
| `contract/<name>.compact` | Your contract. Add more `.compact` files beside it (a test token, say) and they compile too |
| `contract/index.ts` | The compiled contract(s), ready for `deployContract` |
| `contract/witnesses.ts` | With `--witnesses`: your witness implementations and private state |
| `src/test/<name>.sim.test.ts` | In-memory tests with `@midnight-ntwrk/mnkit-sim`: logic, guards, privacy invariants |
| `src/test/<name>.test.ts` | The devnet suite: deploy and call on a real network |
| `src/config.ts`, `src/providers.ts` | Network config (local, preview, preprod) and the midnight-js providers |
| `contract/deploy-args.ts` | What `mnkit deploy` deploys: constructor arguments and initial private state, per contract |
| `scripts/deploy.ts`, `src/deployments.ts` | The deploy `mnkit deploy` runs, and the `deployments/<network>.json` records it writes |
| `compose.yml` | Node, indexer and proof server, at versions that work together |
| `scripts/wait-for-dust.ts`, `scripts/fund-wallet.ts` | Wait for the test wallet's DUST; fund a browser wallet on the local network |
| `SPEC.md`, `AGENTS.md` | A design card, and instructions for AI coding agents |
| `mnkit.json` | The project name, the mnkit version and toolchain it was made with, and the hashes `upgrade` compares against |
| `ui/` | With `mnkit add ui`: the browser UI |

The wallet provider, the in-memory harness and the coin helpers are libraries
(`@midnight-ntwrk/mnkit-wallet`, `mnkit-sim`, `mnkit-coins`), not copied code,
so fixes reach your project with `npm update`.

## Commands

| Command | What it does |
|---|---|
| `mnkit init <dir>` | Scaffold a project. `--witnesses`, `--name <name>`, `--dry-run`, `--skip-install` |
| `mnkit compile` | Compile every contract under `contract/` with the pinned compiler, installing it (and the Compact CLI) if missing. `--skip-zk` skips the proving keys; `--no-install` fails instead of installing |
| `mnkit derive` | Fill the `@generated-stub` regions from the compiled contract |
| `mnkit validate` | The devnet gate: compile, network up, wait for DUST, `test:local`, network down. `--keep-net`, `--report <file>` |
| `mnkit deploy` | Deploy a contract to local, preview or preprod without the UI or the tests, compiling first when needed. `[name]` (default: the project's contract), `--network <net>`, `--no-install` |
| `mnkit add ui` | A browser UI in `ui/` for the compiled contract. `--contract <dir>`, `--private-state memory\|persistent`, `--dry-run`, `--skip-gate`, `--skip-install` |
| `mnkit add contract <name>` | Another contract under `contract/`, wired in by the next `derive` |
| `mnkit upgrade` | Move the project to this mnkit's templates and toolchain. `--check`, `--force`, `--skip-install` |
| `mnkit doctor` | Check Node, Docker, the Compact compiler and the local network's ports. `--network <net>` also checks local, preview or preprod: the node, the indexer and its lag, the proof server's version, and preprod's Blockfrost key |

The project's `npm run compile`, `compile:fast`, `derive`, `validate`,
`deploy` (`deploy:preview`, `deploy:preprod`) and `doctor:preview` /
`doctor:preprod` scripts call these.

## How `derive` stays out of your way

Generated code lives between markers:

```ts
// @generated-stub begin circuits sha=3f2a9c01b7d4
it.todo('increment(by: Uint<0..255>)');
// @generated-stub end circuits
```

The `sha` is a hash of the region's body. `derive` rewrites a region only
while its body still matches, so the moment you edit one it is yours and is
left alone. Delete the markers to take a region over for good. Running
`derive` twice changes nothing.

## Preview and preprod

The devnet suite runs against a remote network too. Start a local proof server
(`npm run proof:up`), put a funded wallet's seed in `.env.preprod` as
`MIDNIGHT_PREPROD_SEED=<hex>` (preprod also needs `BLOCKFROST_PROJECT_ID`), and
run `npm run test:preprod`. `.env.*` files are gitignored. A new wallet syncs
from genesis, which takes a while on preprod.

When a run hangs, `npm run doctor:preview` or `npm run doctor:preprod` tells
you whether the network side is healthy: the node and indexer answer, the
indexer is no more than 100 blocks behind, the proof server runs the pinned
version, and (preprod) Blockfrost accepts the project ID. `mnkit deploy` runs
the same checks before a preview or preprod deploy.

## Status

`mnkit` is new; expect changes before 1.0. Issues and ideas:
[midnight-examples#59](https://github.com/midnightntwrk/midnight-examples/issues/59).

## License

Apache-2.0
