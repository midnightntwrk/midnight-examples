# Token Transfers Example

A Compact contract that exercises Midnight's token primitives end to end —
minting, sending, and receiving across all three token flavors: contract-domain
**unshielded** tokens (color derived from a domain separator), the native
**NIGHT** token, and **shielded** (zswap) coins. Each circuit is a small, focused
example of one operation rather than a full application.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
npm install
```

## Compile the contract

Write your contract in `contract/token-transfers.compact`, then:

```bash
npm run compile
```

## Start the local Midnight network

Ensure the Docker engine is running, then:

```bash
npm run env:up
```

## Run the test suite

```bash
npm run wait:dust     # wait until the dev wallet has spendable DUST for fees
npm run test:local
```

Tear the network down when finished:

```bash
npm run env:down
```

This example is set up for a local devnet running via Docker.

To run it against **preprod** or **preview** instead, see
[FAST-SYNC.md](../../FAST-SYNC.md) at the repo root. In short: start a local proof
server (`npm run proof:up`), then from the repo root run `npm run preseed:cut` followed
by `npm run wallets:new`, fund the printed addresses at the faucet, and run
`npm run test:preprod`. The wallet seeds live in one repo-root `.env.<network>` that
every example shares.

## Browser UI

`ui/` runs these circuits in the browser behind a Midnight wallet. There is no
ledger to show, so it shows your wallet's balances as tokens move. See
[`ui/README.md`](ui/README.md).

```bash
npm run dev -w @midnight-ntwrk/example-token-transfers-ui
```
