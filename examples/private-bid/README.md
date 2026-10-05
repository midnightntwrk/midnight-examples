# Private Bid Example

The contract from the docs guide **How to build a private smart contract**
(`docs/guides/build-a-private-smart-contract` in midnight-docs). A bidder places
a bid that must meet a public minimum. The proof shows the bid meets the minimum,
and the network never learns the amount. The ledger holds only two 32-byte
hashes per bid: a bidder key derived from a secret key kept in private state,
and a salted `persistentCommit` to the amount. Later the bidder can open the
commitment with `revealBid`, the one place the amount is `disclose()`d.

| Data | Where it lives | Public? |
|---|---|---|
| Minimum bid | `sealed ledger minimumBid` | Yes, fixed at deploy |
| Bid amount | circuit argument | No, until `revealBid` |
| Secret key | private state, via the `localSecretKey` witness | Never |
| Bidder key | `bidCommitments` / `revealedBids` map key | Yes, as a hash bound to this contract |
| Bid commitment | `bidCommitments` value | Yes, as a commitment |

Verified on the local devnet only; the guide's Preprod step has not been run
for this example.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract


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
