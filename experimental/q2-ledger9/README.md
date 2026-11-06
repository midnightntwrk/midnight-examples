This project is built on the Midnight Network.

# q2-ledger9: Q2 2026 stagenet suites (ported from stagenet-q2)

A stagenet testing harness for the `compact-end-2-end` dapps, modeled after
`example-usdcx`. One package: a shared `src/` harness (network config, wallet,
DUST bootstrap, providers, contract loader) plus one vitest suite per dapp under
`src/test/`. Contracts live under `contracts/<dapp>/`, compiled into
`contracts/<dapp>/managed/` by `npm run compile`.

## Layout

```
contracts/<dapp>/*.compact      # sources (per-dapp; DEX/FungibleToken names repeat)
contracts/<dapp>/managed/       # compactc output (gitignored, rebuilt by npm run compile)
src/config.ts                   # LOCAL / PREVIEW / PREPROD / STAGENET endpoints
src/wallet.ts src/dust.ts src/providers.ts   # wallet lifecycle + DUST + SDK providers
src/secret.ts src/harness.ts    # per-role secret resolution + funded/address-only helpers
src/contracts.ts                # load + bind + deploy/call/read
src/witnesses/usdcx.ts          # the only witnessed dapp's witness wiring
src/test/<dapp>.test.ts         # one end-to-end suite per dapp
```

## Why a separate npm project

mn-examples is pinned to the ledger 8 stack, and a version move there has to be a
coordinated, repo-wide pass (root `AGENTS.md`). This directory runs on the Ledger 9
release stack instead. [`COMPATIBILITY.md`](COMPATIBILITY.md) lists the versions, what
is still pre-release, and the latest local devnet result.

So it is its own npm project: its own `package.json`, `package-lock.json` and `.npmrc`,
outside the root workspaces. Nothing here changes the root install, and it is not in the
CI matrix.

## Setup

```sh
nvm use 22                                   # Node >= 22
npm install -g npm@11                        # npm 11.10+ (Node 22 bundles npm 10)
cd experimental/q2-ledger9
npm install                                  # its own lockfile
cp .env.stagenet.example .env.stagenet       # fill in funded seeds (gitignored)
```

Install Compact 0.36.0 with the Compact CLI, then compile:

```sh
compact update 0.36.0
npm run compile        # runs `compact compile +0.36.0`; gaps are expected
```

Set `COMPACTC=/path/to/compactc` to compile with a specific compactc binary instead.

Expected result: **compiled 12, failed 3**. The failures are the three gap contracts in
the table below.

## Run

```sh
npm run proof:up        # local proof server on :6300 (proof:down to stop)
npm run test:stagenet   # remote node+indexer (shielded.tools), local proof server
npm run env:up          # local Ledger 9 node + indexer + proof server (env:down to stop)
npm run test:local      # against that devnet on :9944 / :8088
```

The devnet uses the same ports as the mn-examples local network (ledger 8). Stop that
network first, or these suites will talk to the wrong node and proof server.

The suites source secrets from `.env.<network>` via vitest's `loadEnv`. On remote
networks each **submitting** wallet must hold NIGHT and be DUST-registered (the
harness registers DUST automatically once NIGHT is present).

### Wallet roles

Only the **deployer** (every dapp) and **relayer** (usdcx) submit transactions and
need funding. `trader` / `lp` / `caller_*` are *address-only* participants — the
deployer pays and submits on their behalf, so their seeds only need to derive a
distinct address (no funding). Set seeds in `.env.stagenet`.

## Dapp status (Compact 0.36.0)

Compile status on Compact 0.36.0. For the latest run results, see
[`COMPATIBILITY.md`](COMPATIBILITY.md#local-devnet-result-2026-11-05).

| Dapp | Contracts | Witnesses | Compile |
|------|-----------|-----------|---------|
| fungible-token | 1 | — | compiles |
| events | 1 | — | compiles |
| no-witness-dex | 2 | — | compiles |
| uniswap | 3 | — | compiles |
| usdcx | 1 | 7 | compiles |
| eth-addr-secp | 1 | — | compiles |
| verify-sequential-secp | 1 | 6 | compiles |
| caller | 2 | — | compiles (was a gap on 0.33.0-rc.2) |
| self-recursion | 1 | — | compile gap (`cycle involving type SelfRecursionSelf`). Suite SKIPS |
| axelar-gateway | 1 | — | compile gap (`another binding found for mint_token`). Suite SKIPS |
| recover-secp | 1 | — | compile gap (`Secp256k1EcdsaSignatureWithRecovery` unbound). Suite SKIPS |

### secp256k1

Compact 0.36.0 binds the secp256k1 and Keccak surface without a feature flag.
`--feature-zkir-v3`, which 0.33.0-rc.2 needed, is no longer accepted. The recover path
(`Secp256k1EcdsaSignatureWithRecovery` + `secp256k1EcdsaRecover`) is still absent, so
`recover-secp` stays a compile-gap regression guard.
