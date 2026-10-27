# Lottery Example

A NIGHT lottery with a draw nobody can predict or steer. Midnight has no
on-chain randomness, so the organizer commits to a secret seed at deployment,
before any ticket is sold, and every ticket mixes a fresh random nonce into a
public running hash. `draw` proves in zero knowledge that the winning ticket is
`hash(seed, entropy) mod ticketCount` for the committed seed, without the seed
ever reaching the chain. Tickets are paid in unshielded NIGHT, and the holder
of the winning ticket claims the whole pot. The design, including what the
organizer is still trusted with, is in [`SPEC.md`](SPEC.md). A browser UI is
in [`ui/`](ui/README.md).

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

The contract is `contract/lottery.compact`:

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
