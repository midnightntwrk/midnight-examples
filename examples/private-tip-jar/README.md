# Private Tip Jar Example

A private tip jar. Anyone can drop a shielded coin into the jar without saying
who they are, and only the jar's owner can take coins out. The `tip` circuit
takes no identity at all: it receives the tipper's coin and immediately re-sends
it to the contract itself, so the public pot only ever holds contract-owned
coins whose nonces don't point back at a tipper's wallet. `withdraw` checks a
hash of the owner's secret key (supplied by a witness) and pays one pot coin to
the owner's shielded wallet. Tip *values* stay public, so an observer can see
"someone tipped 40" but not who. The full list of what is and isn't public is in
[AGENTS.md](AGENTS.md#privacy-what-is-public-and-what-isnt). The example
also ships a tiny demo token (`contract/tip-token.compact`) because a fresh
devnet has no shielded tokens to tip with.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

Both contracts (`contract/private-tip-jar.compact` and `contract/tip-token.compact`) compile with:

```bash
yarn compile
```

## Start the local Midnight network

Ensure the Docker engine is running, then:

```bash
yarn env:up
```

## Run the test suite

```bash
yarn wait:dust     # wait until the dev wallet has spendable DUST for fees
yarn test:local
```

Tear the network down when finished:

```bash
yarn env:down
```

This example is set up for a local devnet running via Docker.

To run it against **preprod** or **preview** instead, see
[FAST-SYNC.md](../../FAST-SYNC.md) at the repo root. In short: start a local proof
server (`yarn proof:up`), then from the repo root run `yarn preseed:cut` followed
by `yarn wallets:new`, fund the printed addresses at the faucet, and run
`yarn test:preprod`. The wallet seeds live in one repo-root `.env.<network>` that
every example shares.
