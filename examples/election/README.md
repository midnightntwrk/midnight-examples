# Election Example

A two-candidate election using commit-reveal. Voters register a key derived
from a witness secret and bound to this deployment, so the same secret gives
an unrelated key in any other election. While voting is open, each voter
commits a hash of their vote and secret, so the tally can't be read during
voting. After the organizer closes voting, each voter reveals: the contract
recomputes the commitment, rejects a changed vote, and counts it. `Set`s stop
double registration, double voting and double reveals; `Counter`s hold the
tally; and the organizer and candidates are `sealed` at deployment.

The constructor takes the two candidates and a random 32-byte instance nonce:
`args: [candidateA, candidateB, randomBytes(32)]`. Use a fresh nonce for every
deployment. It is what keeps the organizer's key unique to this election (see
[Keys bound to the deployment](../../docs/compact-gotchas.md#identity-and-commitments)).

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

Write your contract in `contract/election.compact`, then:

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
