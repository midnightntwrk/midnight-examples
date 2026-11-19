# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `examples/voting`: anonymous, allow-listed yes / no / abstain voting with one transaction per voter, for MIP and MPS votes. Voters prove membership of a Merkle voter list and publish a per-proposal nullifier with a hiding commitment, plus a copy of the ballot encrypted to the admin keys (X25519 + XChaCha20-Poly1305). After voting closes, the admin decrypts the ballots and calls a permissionless `count`, which is checked against each commitment. Includes an admin/voter CLI (`npm run vote`).

### Changed

- Toolchain moved to the Release 1 1.1-patch: Compact compiler 0.36.1 (language 0.28, Compact runtime 0.21.0), Midnight.js and testkit-js 5.0.1, wallet SDK 2.0.1, `wallet-sdk-address-format` 4.0.1, proof server 9.0.2, and overrides `ledger-v9` 1.0.2, `onchain-runtime-v4` 4.0.2 and `zkir-v3` 3.2.1. The patch fixes contract calls that write a held shielded coin back (`Custom error: 104`, [midnight-ledger issue 839](https://github.com/midnightntwrk/midnight-ledger/issues/839)) and calls paid with a single DUST spend (`OutsideTimeToDismiss`, [midnight-ledger issue 838](https://github.com/midnightntwrk/midnight-ledger/issues/838)). No contract source changes; recompiling with 0.36.1 leaves the generated keys valid. `experimental/q2-ledger9` moves to the same stack.

### Removed

- Pre-seed fast sync: the `preseed/` bundles, `npm run preseed:cut`, `FAST-SYNC.md` and the `_BIRTHDAY` lines that `npm run wallets:new` wrote. It was off on Ledger 9 (wallet SDK 2 changed the snapshot format it rewrote), and the Preview bundle came from the chain before the 6 November reset, which made `wallets:new` fail on Preview ([issue 91](https://github.com/midnightntwrk/midnight-examples/issues/91)). Saved wallet state and `skipLedgerV8DustHistory` keep remote syncs short.
- `@midnight-ntwrk/midnight-js-network-id` and every `setNetworkId()` call, from the examples, their UIs, the mnkit templates, `@midnightntwrk/mnkit-wallet` (no longer a peer dependency) and `toolchain.json`. Midnight.js 5.0.0 doesn't read the global network ID; the providers take `config.networkId`.

### Fixed

- Saved wallet state (`.wallet-state/`) is checked before it is restored: each save records the indexer's host and its tip (height and block hash), and a state from another indexer, or from a chain that was reset since (Preview kept its genesis hash through the 6 November reset), is not restored, so that wallet syncs from genesis. Files saved before this change are restored once and stamped on their next save ([issue 91](https://github.com/midnightntwrk/midnight-examples/issues/91)).
- `examples/shielded-chips`: the "Alice burns from the treasury" end-to-end test runs again. It was skipped on Ledger 9 because the node rejected `burnFromTreasury` with `Custom error: 104` ([midnight-ledger issue 839](https://github.com/midnightntwrk/midnight-ledger/issues/839)); the 1.1-patch's ledger-v9 1.0.2 fixes that on the client side, and the test passes on Preview.
- `examples/zk-loan`: the Schnorr verifier's `response` is a `JubjubScalar` now, so the generated witness type check rejects `s + order` (the old `response as JubjubScalar` cast reduced it back to `s`); signers must reduce `s` mod the order. The challenge quotient bound is tight: `q < 115`, or `q == 115` with the remainder below `P - 115 * 2^248`. With `q < 116` about 0.06% of challenge hashes had two accepted `(q, r)` pairs. Three simulator tests cover it, and the tutorials match the code. `requestLoan`'s circuit changes, so its prover and verifier keys change: redeploy rather than pointing a rebuilt UI at an existing contract.

## mnkit 0.2.0 (unreleased)

The first npm release of `mnkit` and its runtime packages `@midnightntwrk/mnkit-wallet`, `@midnightntwrk/mnkit-sim` and `@midnightntwrk/mnkit-coins`. All four share one version. Release candidates (`0.2.0-rc.2`) go to the `next` dist-tag first; `0.2.0-rc.1` was never published.

### Added

- `mnkit init <dir>` scaffolds a standalone npm project around your own Compact contract, with an `mnkit.json` manifest that makes it upgradable.
- `mnkit compile` compiles every contract with the pinned compiler, installing the pinned compiler or Compact CLI when it's missing (`--no-install` opts out).
- `mnkit derive` fills the generated stub regions from the compiled contract.
- `mnkit validate` runs the local-network tests end to end: compile, network up, wait for DUST, `test:local`, network down.
  `--reuse-net` skips the network and DUST steps on a network a `--keep-net` run left up, and `--files <a,b>` runs only those test files; the JSON report (`--report`) lists each test file's result.
- Design-card helpers: `cardWitnesses` (whether the card's Witnesses section declares any) and `reviewMark` (its `Reviewed-by: <who>, <YYYY-MM-DD>` line) in the spec lint, and `skeletonCard` (the template card for a project not scaffolded yet) in the scaffold library.
- `mnkit deploy [name]` deploys to local, preview or preprod without the UI, and records the address in `deployments/<network>.json`.
- `mnkit doctor` checks the machine, and with `--network <net>` checks the network's node, indexer and proof server.
- `mnkit add ui` adds a browser UI as a workspace, and `mnkit add contract <name>` adds another contract.
- `mnkit upgrade` moves a project to the current templates and toolchain with a three-way merge (`--check`, `--force`).
- `@midnightntwrk/mnkit-wallet` (`MidnightWalletProvider`, wallet state saved after each sync on a remote network and restored on the next build, `fundWallet`, `waitForDust`), `@midnightntwrk/mnkit-sim` and `@midnightntwrk/mnkit-coins`.
- `startWallet(logger, env, { network, role, faucet, syncTimeoutMs })` in `@midnightntwrk/mnkit-wallet` and the template's `src/wallet.ts` builds, starts and syncs a wallet, and on a remote network waits until it is funded. The template devnet test uses it, and its comment shows the two lines a second wallet takes. `private-tip-jar`, `shielded-chips` and `leaderboard` use it in place of their own copies of `buildWallet(role)`, and `private-tip-jar` reads token coins and balances with the `coins.ts` helpers ([issue 13](https://github.com/midnightntwrk/midnight-examples/issues/13)).
- The template sim test deploys as an explicit `DEPLOYER_COIN_PK`, so a constructor that records its caller as owner has a known key to check. `mnkit derive` notes pure circuits in both tests: the sim test says to call `pureCircuits.<name>(...)` directly, and the devnet test names them and says they are tested in memory only. A second contract still gets no in-memory stubs, and one with its own witnesses is still wired by hand; both are listed as deliberate gaps ([issue 15](https://github.com/midnightntwrk/midnight-examples/issues/15)).

### Toolchain

- Generated projects are on the Ledger 9 stack: Compact compiler 0.36.1 (language 0.28), Midnight.js 5.0.1, testkit-js 5.0.1, wallet SDK 2.0.1 (`@midnightntwrk/wallet-sdk`), proof server 9.0.2. The examples, their UIs and mnkit now share one set of pins in `toolchain.json`.
- Pre-seed fast sync is removed from `@midnightntwrk/mnkit-wallet`: `MidnightWalletProvider.build` and `assembleWallet` no longer take a `fastSync` option, `resolveWallet` no longer returns one or reads `_BIRTHDAY`, and `getOrCreateTestWallet` no longer takes or records a chain tip. `isSeedable`, `preSeedNewWallet`, `findReferenceRoot`, `loadReferenceBundle`, `readReferenceBundle` and `checkChainIdentity` are gone. Saved wallet state is checked against the chain before it is restored; `readChainStamp` and `checkChainStamp` are exported for the same check elsewhere.
- The local devnet (`compose.yml`) runs node 2.1.101 and indexer 4.4.101, so `mnkit validate` and the other local-network steps work on Ledger 9.
