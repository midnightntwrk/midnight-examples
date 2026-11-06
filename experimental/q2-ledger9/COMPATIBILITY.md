# Ledger 9 compatibility matrix

The component versions these suites build and run against: the expected Ledger 9
release stack, as far as it is installable today. Where a final release isn't on npm or
Docker Hub yet, the table pins the newest pre-release and says so. Node and indexer are
listed as TBA until their Ledger 9 releases are published.

Checked against npm and Docker Hub on 2026-11-05.

## Builder components

| Component | Version | Package or image | Status |
| --- | --- | --- | --- |
| Compact toolchain | 0.36.0 | `compact update 0.36.0` | final |
| Compact runtime | 0.21.0 | `@midnight-ntwrk/compact-runtime` | final |
| Compact.js | 3.0.0 | `@midnight-ntwrk/compact-js` | final |
| Ledger | 1.0.0 | `@midnightntwrk/ledger-v9` | final |
| On-chain runtime | 4.0.0 | `@midnightntwrk/onchain-runtime-v4` | final |
| ZKIR | 3.2.0 | `@midnight-ntwrk/zkir-v3` | final |
| Midnight.js | 5.0.0-rc.6 | `@midnight-ntwrk/midnight-js-*` (`midnight-js-network-id` 5.0.0-rc.5, the newest published) | **pre-release**, no 5.0.0 yet |
| Wallet SDK | facade 5.0.0, dust-wallet 5.0.0, shielded 4.0.0, unshielded-wallet 4.0.0, hd 4.0.0, address-format 4.0.0, abstractions 3.0.0 | `@midnightntwrk/wallet-sdk-*` | final |
| Proof server | 9.0.0 | `midnightntwrk/proof-server:9.0.0` | final |

`package.json` overrides Midnight.js 5.0.0-rc.6's exact pins (`ledger-v9` 1.0.0-rc.7,
`compact-js` 3.0.0-rc.6) up to the finals above, so the tree holds one copy of each.

## Network components

| Component | Version | Status |
| --- | --- | --- |
| Node | TBA | Ledger 9 release not published |
| Indexer | TBA | Ledger 9 release not published yet |

For local runs, `compose.yml` uses the newest public Ledger 9 images: node
`midnightntwrk/midnight-node:2.1.0-rc.4` and indexer
`midnightntwrk/indexer-standalone:4.4.0-rc.6`. These are pre-releases and don't match the
final client libraries (see the result below).

## Moving from Ledger 8

- Contracts deployed under Ledger 8 carry over the fork with their state, and Midnight.js 5
  can still call them through its
  [keep-state path](https://github.com/midnightntwrk/midnight-js/blob/main/packages/contracts/docs/keep-state-pipeline.md),
  running the original Ledger 8 artifacts. Midnight.js refuses a new deploy or a
  maintenance update of a Ledger 8 artifact after the fork, so for those (and for new
  work) recompile with Compact 0.36.0 and rebuild against the packages above.
- Ledger 8-format transactions are rejected after the fork, including ones built and
  proved before it but not yet submitted. Rebuild them with the Ledger 9 stack.
- The on-chain runtime moves from `onchain-runtime-v3` to `onchain-runtime-v4`. The major
  version is in the package name, so change the dependency name, not just the range.
- Midnight.js 5 providers are tagged with the ledger eras they serve. Contract state
  comes back as era-tagged bytes (`read.contractState.deserialize({ v9: ContractState })`),
  and cross-contract calls need a `contractModuleProvider`.
- Wallet SDK 2.0 wallets fork across the Ledger 8 to Ledger 9 boundary, so they start
  from seeds (`WalletSeeds.fromMasterSeed`, `facade.start(seeds)`) rather than from key
  objects.
- Compact 0.36.0 no longer takes `--feature-zkir-v3`. The secp256k1 and Keccak surface
  is available without it.

## Local devnet result (2026-11-05)

Run with `npm run env:up && npm run test:local` on node 2.1.0-rc.4, indexer 4.4.0-rc.6
and proof server 9.0.0, with the stack above.

**Compile:** 12 of 15 contracts compile. `caller/Caller` used to be a gap and now
compiles. The remaining gaps are self-recursion (`cycle involving type
SelfRecursionSelf`), axelar-gateway (`another binding found for mint_token`) and
recover-secp (`Secp256k1EcdsaSignatureWithRecovery` unbound).

**Tests:** 5 passed, 18 failed, 7 skipped. After fixing the cross-contract harness, the
three cross-contract suites were re-run, and their results are the ones below.

| Suite | Result | Notes |
| --- | --- | --- |
| fungible-token | deploy passes; transfer fails | node rejects `transfer` with `Custom error: 104` |
| events | fails | setup `transfer` rejected with 104, so there are no events to read |
| no-witness-dex | fails | setup `transfer` rejected with 104; the swap then finds no callee state |
| uniswap | deploy passes; rest fails | setup `transfer` rejected with 104; the swaps then find no callee state |
| usdcx | deploy passes; mint fails | `receiveAndMint` rejected with 104 |
| eth-addr-secp | initial read passes; store fails | `storeEthereumAddress` rejected with 104 |
| verify-sequential-secp | initial read passes; calls fail | `two` / `three` rejected with 104 |
| caller | fails | `forward` rejected with 104; `capture()` was accepted, but the ledger read shows `last_caller` unset (not yet diagnosed) |
| self-recursion, axelar-gateway, recover-secp | skipped | compile gaps |

Every deploy succeeds. Every contract call the node rejects fails with
`1010: Invalid Transaction: Custom error: 104` (out of gas budget). This is the known
mismatch between the final client libraries and the pre-release node: re-run on the
Ledger 9 node release once it is published, before reading these failures as regressions.

Not exercised locally: DUST registration (`src/dust.ts`), which runs only on remote
networks.
