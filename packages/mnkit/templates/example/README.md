# __Title__ Example

> TODO: one paragraph describing what this example demonstrates.

## Set up

<!-- @if monorepo -->
Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```
<!-- @endif -->
<!-- @if standalone -->
You need Node 22 or later, Docker, and the Compact CLI (`compact`), with
compiler __TC_COMPILER__ installed: `compact update __TC_COMPILER__ --no-set-default`.
`npx mnkit doctor` checks all of it. Then install dependencies:

```bash
npm install
```
<!-- @endif -->

## Compile the contract

Write your contract in `contract/__name__.compact`, then:

```bash
__RUN__ compile
```

## Start the local Midnight network

Ensure the Docker engine is running, then:

```bash
__RUN__ env:up
```

## Run the test suite

```bash
__RUN__ wait:dust     # wait until the dev wallet has spendable DUST for fees
__RUN__ test:local
```

Tear the network down when finished:

```bash
__RUN__ env:down
```

This example is set up for a local devnet running via Docker.

<!-- @if monorepo -->
To run it against **preprod** or **preview** instead, see
[FAST-SYNC.md](../../FAST-SYNC.md) at the repo root. In short: start a local proof
server (`yarn proof:up`), then from the repo root run `yarn preseed:cut` followed
by `yarn wallets:new`, fund the printed addresses at the faucet, and run
`yarn test:preprod`. The wallet seeds live in one repo-root `.env.<network>` that
every example shares.
<!-- @endif -->
<!-- @if standalone -->
To run it against **preprod** or **preview** instead, start a local proof server
(`npm run proof:up`), put a funded wallet's seed in `.env.<network>` as
`MIDNIGHT_PREPROD_SEED=<hex>` (or `MIDNIGHT_PREVIEW_SEED`; preprod also needs
`BLOCKFROST_PROJECT_ID`), and run `npm run test:preprod`. The `.env.*` files are
gitignored. A new wallet syncs from genesis, which takes a while on preprod.

## Regenerate the stubs

After you change the contract, run `npm run compile:fast` and then
`npx mnkit derive`. It refreshes the generated stubs (witnesses, constructor
arguments, a test per circuit) that you haven't edited, and leaves everything
else alone.

## Add more

- `npx mnkit add ui`: a browser UI in `ui/` (run `npm run compile` first; it
  needs the proving keys). See `ui/README.md` once it exists.
- `npx mnkit add contract <name>`: another contract under `contract/`, wired
  in by the next `npx mnkit derive`.

## Upgrade

`npm install --save-dev mnkit@latest && npx mnkit upgrade` moves the project to
the newer mnkit's templates and toolchain. Files you haven't edited are
replaced; for a file you and the template both changed, the new version is
written next to yours as `<file>.mnkit-new`.
<!-- @endif -->
