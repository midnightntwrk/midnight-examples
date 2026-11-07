# Election Example

A two-candidate election using commit-reveal. Voters register a DApp-specific
key derived from a witness secret. While voting is open, each voter commits a
hash of their vote and secret, so the tally can't be read during voting. After
the organizer closes voting, each voter reveals: the contract recomputes the
commitment, rejects a changed vote, and counts it. `Set`s stop double
registration, double voting and double reveals; `Counter`s hold the tally; and
the organizer and candidates are `sealed` at deployment.

Revealing is public. A reveal increments one candidate's counter and inserts the voter's
registration key into `revealedVoters`, so once the reveal phase is over anyone reading the
ledger can list each registration key with its vote: the tally is hidden while voting is open,
but the final ballot is open, not secret. A secret ballot would reveal against a commitment
tree with a separate nullifier instead of looking the vote up by the voter's key.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
npm install
```

## Compile the contract

Write your contract in `contract/election.compact`, then:

```bash
npm run compile
```

## Start the local Midnight network

> **The local devnet isn't on Ledger 9 yet.** It still runs public images that predate
> Ledger 9, so contract calls fail under `npm run test:local`. Run the network tests
> with `npm run test:preview` for now. See
> [Local devnet: not on Ledger 9 yet](../../README.md#local-devnet-not-on-ledger-9-yet).

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

To run it against **preprod** or **preview** instead, start a local proof server
(`npm run proof:up`), then from the repo root run `npm run wallets:new`, fund the
printed addresses at the faucet, and run `npm run test:preprod`. The wallet seeds
live in one repo-root `.env.<network>` that every example shares. Each wallet
syncs from genesis, which takes over an hour on preprod.
