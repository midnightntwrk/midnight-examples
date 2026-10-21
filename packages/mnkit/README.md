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
  (`compact`), with the compiler version mnkit pins installed. `npx mnkit
  doctor` tells you which one and how to install it.
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

## What you get

| Path | What it is |
|---|---|
| `contract/<name>.compact` | Your contract. Add more `.compact` files beside it (a test token, say) and they compile too |
| `contract/index.ts` | The compiled contract(s), ready for `deployContract` |
| `contract/witnesses.ts` | With `--witnesses`: your witness implementations and private state |
| `src/test/<name>.sim.test.ts` | In-memory tests with `@midnight-ntwrk/mnkit-sim`: logic, guards, privacy invariants |
| `src/test/<name>.test.ts` | The devnet suite: deploy and call on a real network |
| `src/config.ts`, `src/providers.ts` | Network config (local, preview, preprod) and the midnight-js providers |
| `compose.yml` | Node, indexer and proof server, at versions that work together |
| `SPEC.md`, `AGENTS.md` | A design card, and instructions for AI coding agents |
| `mnkit.json` | The project name and the mnkit version it was made with |

The wallet provider, the in-memory harness and the coin helpers are libraries
(`@midnight-ntwrk/mnkit-wallet`, `mnkit-sim`, `mnkit-coins`), not copied code,
so fixes reach your project with `npm update`.

## Commands

| Command | What it does |
|---|---|
| `mnkit init <dir>` | Scaffold a project. `--witnesses`, `--name <name>`, `--dry-run`, `--skip-install` |
| `mnkit compile` | Compile every contract under `contract/` with the pinned compiler. `--skip-zk` skips the proving keys |
| `mnkit derive` | Fill the `@generated-stub` regions from the compiled contract |
| `mnkit validate` | The devnet gate: compile, network up, wait for DUST, `test:local`, network down. `--keep-net`, `--report <file>` |
| `mnkit doctor` | Check Node, Docker, the Compact compiler and the local network's ports |

The project's `npm run compile`, `compile:fast`, `derive` and `validate`
scripts call these.

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

## Status

`mnkit` is new; expect changes before 1.0. Coming next: `mnkit add ui` (a
browser UI with wallet connect), `mnkit add contract`, and `mnkit upgrade` to
move a project to a newer toolchain. Issues and ideas:
[midnight-examples#59](https://github.com/midnightntwrk/midnight-examples/issues/59).

## License

Apache-2.0
