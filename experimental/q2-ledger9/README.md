This project is built on the Midnight Network.

# q2-ledger9: Q2 2026 stagenet suites (ported from stagenet-q2)

A stagenet testing harness for the `compact-end-2-end` dapps, modeled after
`example-usdcx`. One package: a shared `src/` harness (network config, wallet,
DUST bootstrap, providers, contract loader) plus one vitest suite per dapp under
`src/test/`. Contracts live under `contracts/<dapp>/`, compiled into
`contracts/<dapp>/managed/` by `yarn compile`.

## Layout

```
contracts/<dapp>/*.compact      # sources (per-dapp; DEX/FungibleToken names repeat)
contracts/<dapp>/managed/       # compactc output (gitignored, rebuilt by yarn compile)
src/config.ts                   # LOCAL / PREVIEW / PREPROD / STAGENET endpoints
src/wallet.ts src/dust.ts src/providers.ts   # wallet lifecycle + DUST + SDK providers
src/secret.ts src/harness.ts    # per-role secret resolution + funded/address-only helpers
src/contracts.ts                # load + bind + deploy/call/read
src/witnesses/usdcx.ts          # the only witnessed dapp's witness wiring
src/test/<dapp>.test.ts         # one end-to-end suite per dapp
```

## Why a separate Yarn project

This is a **frozen snapshot** of the Q2 stagenet run, ported from the standalone
`stagenet-q2` repo. mn-examples is pinned to the ledger 8 stack, and a version move
there has to be a coordinated, repo-wide pass (root `AGENTS.md`). This directory pins
an early ledger 9 stack instead:

| Component | Version |
|---|---|
| compactc | 0.33.0-rc.2 (pre-release, not installable with `compact update`) |
| Midnight.js | 5.0.0-beta.6 |
| Ledger / on-chain runtime | `@midnightntwrk/ledger-v9` 1.0.0-rc.3 / `onchain-runtime-v4` 4.0.0-rc.3 |
| compact-runtime / compact-js | 0.18.0-rc.1 / 2.5.5-rc.7 |
| Wallet SDK | `@midnightntwrk/wallet-sdk-facade` 5.0.0-beta.2 |
| Proof server image | `midnightntwrk/proof-server:9.0.0-rc.6` |
| Target node | stagenet, midnight-node 2.0.x (specVersion 2_000_000) |

So it is its own Yarn project, like `../q3-ledger9`: its own `package.json`,
`yarn.lock` and `.yarnrc.yml`, outside the root workspaces. Nothing here changes the
root install, and it is not in the CI matrix.

## Setup

```sh
nvm use 22                                   # Node >= 22
corepack enable                              # Yarn 4 via packageManager
cd experimental/q2-ledger9
yarn install                                 # its own lockfile
cp .env.stagenet.example .env.stagenet       # fill in funded seeds (gitignored)
```

Download compactc 0.33.0-rc.2 for your platform from the
[`compactc-v0.33.0-rc.2` release](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.33.0-rc.2)
and unzip it. `yarn compile` requires `COMPACTC` to point at it:

```sh
COMPACTC=/path/to/compactc-0.33.0-rc.2/compactc yarn compile   # gaps are expected
```

Expected result: **compiled 11, failed 4**. The failures are the four gap contracts in
the table below. `caller/Proxy` compiles; only `caller/Caller` fails.

## Run

```sh
yarn proof:up          # local proof server on :6300 (proof:down to stop)
yarn test:stagenet     # remote node+indexer (shielded.tools), local proof server
yarn test:local        # against a local devnet on :9944 / :8088
```

The proof server and the local endpoints use the same ports as the mn-examples local
network (ledger 8). Stop that network first, or these suites will talk to the wrong
proof server.

The suites source secrets from `.env.<network>` via vitest's `loadEnv`. On remote
networks each **submitting** wallet must hold NIGHT and be DUST-registered (the
harness registers DUST automatically once NIGHT is present).

### Wallet roles

Only the **deployer** (every dapp) and **relayer** (usdcx) submit transactions and
need funding. `trader` / `lp` / `caller_*` are *address-only* participants — the
deployer pays and submits on their behalf, so their seeds only need to derive a
distinct address (no funding). Set seeds in `.env.stagenet`.

## Dapp status (compactc 0.33.0-rc.2, stagenet)

| Dapp | Contracts | Witnesses | Status |
|------|-----------|-----------|--------|
| fungible-token | 1 | — | compiles + runs |
| events | 1 | — | compiles + runs (ledger + contract-log events) |
| no-witness-dex | 2 | — | compiles; CCC swap asserts green-or-known-callee-state-gap |
| uniswap | 3 | — | compiles; CCC swap asserts green-or-known-callee-state-gap |
| usdcx | 1 | 7 | compiles from source (`--feature-zkir-v3`); deploy + mint + replay-guard |
| eth-addr-secp | 1 | — | compiles from source (`--feature-zkir-v3`); provable secp256k1→ETH address |
| verify-sequential-secp | 1 | 6 | compiles from source (`--feature-zkir-v3`); 2×/3× ECDSA verify + reject |
| self-recursion | 1 | — | compile gap (self-interface) — suite SKIPS |
| caller | 2 | — | compile gap (kernel.caller) — suite SKIPS |
| axelar-gateway | 1 | — | compile gap (self-interface) — suite SKIPS |
| recover-secp | 1 | — | compile gap (`secp256k1EcdsaRecover` removed since rc.1) — suite SKIPS |

### secp256k1 / `--feature-zkir-v3`

The secp256k1 surface — the `Secp256k1Point` type, the `Secp256k1EcdsaSignature`
`{r,s}` struct, and the `secp256k1Ecdsa*` / `secp256k1EthereumAddress` circuits —
lives in the compiler's zkir-v3 library and is only bound with `--feature-zkir-v3`
(wired per-contract in `scripts/compile.mts`). On rc.2, usdcx, eth-addr-secp, and
verify-sequential-secp all compile **from source** to provable circuits with that
flag — no prebuilt artifact needed.

The **recover path** (`Secp256k1EcdsaSignatureWithRecovery` + `secp256k1EcdsaRecover`)
was removed between 0.33.0-rc.0 and rc.1 and is **still absent in rc.2** (unbound even
with the flag). The `recover-secp` suite is a compile-gap regression guard that runs
the moment the API is restored.
