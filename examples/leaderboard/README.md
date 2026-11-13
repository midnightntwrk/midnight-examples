# Leaderboard Example

An arcade-style leaderboard with a browser UI, deployed as a static site on
Vercel. Every score a player submits becomes a new public entry, under a name
they choose or under an anonymous name derived from their secret key. Each
entry stores a commitment to the player's key, so later the player can prove
with a zero-knowledge proof that an entry is theirs without revealing the key.
Scores and names are public. The full list of what is and isn't public is in
[AGENTS.md](AGENTS.md#privacy-what-is-public-and-what-isnt).

Step 7 of the [learning path](../../README.md#learning-path). The tutorial in
[`tutorials/`](tutorials/index.mdx) walks through the contract, the API layer,
the browser DApp and the Vercel deployment, and is published at
[docs.midnight.network/tutorials/leaderboard](https://docs.midnight.network/tutorials/leaderboard).

## Layout

- `contract/`: the Compact contract, its witnesses, and the committed compiler
  output in `contract/managed/leaderboard/`.
- `api/`: `LeaderboardAPI`, the platform-agnostic layer the UI and the tests
  share.
- `ui/`: the React DApp. It connects to the Lace wallet for transactions and
  reads the leaderboard from the indexer without a wallet.
- `vercel.json`: the Vercel build settings.

## Set up

Install dependencies (from the repo root, which has one lockfile for the whole
workspace):

```bash
npm install
```

## Compile the contract

```bash
npm run compile
```

The compiler output in `contract/managed/leaderboard/` is committed, because the
Vercel build has no Compact compiler. Commit it again whenever you change
`contract/leaderboard.compact`; CI fails if it is out of date. Don't commit the
output of `npm run compile:fast`, which leaves out the proving keys.

## Run the tests

The in-memory tests need no network:

```bash
npm run test:sim
```

The network tests run against preview or preprod. The local devnet isn't on
Ledger 9 yet (see
[Local devnet: not on Ledger 9 yet](../../README.md#local-devnet-not-on-ledger-9-yet)).
Start a local proof server, then from the repo root run `npm run wallets:new`
and fund the printed addresses at the faucet:

```bash
npm run proof:up
npm run test:preview
```

## Run the DApp

You need the [Lace wallet](https://www.lace.io/) set to Preprod, with tNIGHT
from the [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/) and
DUST generated from it. Reading the leaderboard needs a Blockfrost Midnight
Preprod project ID:

```bash
cd ui
VITE_BLOCKFROST_PROJECT_ID=<your project id> npm run dev
```

Open http://localhost:3000, connect Lace, and deploy a new leaderboard or join
an existing one by its address.

## Deploy to Vercel

Import `midnightntwrk/midnight-examples` (or your fork) into Vercel and set:

- **Root Directory:** `examples/leaderboard`. Vercel then reads
  [`vercel.json`](vercel.json), which installs from the repo root and builds
  `ui/`.
- **Environment variables:** `VITE_BLOCKFROST_PROJECT_ID`, and optionally
  `VITE_DEFAULT_CONTRACT` (the leaderboard the page opens with) and
  `VITE_NETWORK_ID` (defaults to `preprod`).

The [deployment tutorial](tutorials/deployment.mdx) covers each step.
