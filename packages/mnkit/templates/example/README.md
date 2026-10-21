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
You need Node 22 or later and Docker. The first compile installs the Compact
CLI and compiler __TC_COMPILER__ if they are missing; it changes your default
compiler only if you have none. `npx mnkit doctor` checks all of it. Then
install dependencies:

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

## Deploy

`yarn deploy` deploys the contract to the local network without the UI or the
test suite; `yarn deploy:preview` and `yarn deploy:preprod` deploy to those
networks. `yarn deploy <contract>` deploys another contract under `contract/`.
The constructor arguments and initial private state come from
`contract/deploy-args.ts`, and the address lands in `deployments/<network>.json`.
Off local, set `MIDNIGHT_PRIVATE_STATE_PASSWORD` in the repo-root
`.env.<network>`: it encrypts the private state and signing key kept in
`.mnkit/private-state/<network>`.
<!-- @endif -->
<!-- @if standalone -->
To run it against **preprod** or **preview** instead, start a local proof server
(`npm run proof:up`), put a funded wallet's seed in `.env.<network>` as
`MIDNIGHT_PREPROD_SEED=<hex>` (or `MIDNIGHT_PREVIEW_SEED`; preprod also needs
`BLOCKFROST_PROJECT_ID`), and run `npm run test:preprod`. The `.env.*` files are
gitignored. A new wallet syncs from genesis, which takes a while on preprod.

## Deploy without the UI

```bash
npx mnkit deploy                        # the local network (env:up and wait:dust first)
npx mnkit deploy --network preprod      # or preview
npx mnkit deploy <name>                 # another contract under contract/
```

`deploy` compiles first if the compiled contract is missing or out of date, then
deploys with the constructor arguments and initial private state in
`contract/deploy-args.ts`. That file is yours: `npx mnkit derive` fills its
placeholders from the contract, and a constructor that needs another contract's
address can read it from `ctx.deployments`. Deploy that contract first.

The address and transaction go into `deployments/<network>.json`. Commit
`preview.json` and `preprod.json`, so others (and the UI's Join) can find the
contract; `local.json` is gitignored. A proof server must be running on every
network (`npm run proof:up`).

Off local, the deploy uses the wallet in `.env.<network>`, as `test:preprod`
does, and needs `MIDNIGHT_PRIVATE_STATE_PASSWORD` there too: at least 16
characters, with 3 of upper case, lower case, digits and symbols. It encrypts
what `deploy` keeps in `.mnkit/private-state/<network>`: the contract's private
state and its signing key, which you need to maintain the contract later. Back
that directory up, and keep the password.

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
