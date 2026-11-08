# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## mnkit 0.2.0 (unreleased)

The first npm release of `mnkit` and its runtime packages `@midnightntwrk/mnkit-wallet`, `@midnightntwrk/mnkit-sim` and `@midnightntwrk/mnkit-coins`. All four share one version. Release candidates (`0.2.0-rc.2`) go to the `next` dist-tag first; `0.2.0-rc.1` was never published.

### Added

- `mnkit init <dir>` scaffolds a standalone npm project around your own Compact contract, with an `mnkit.json` manifest that makes it upgradable.
- `mnkit compile` compiles every contract with the pinned compiler, installing the pinned compiler or Compact CLI when it's missing (`--no-install` opts out).
- `mnkit derive` fills the generated stub regions from the compiled contract.
- `mnkit validate` runs the local-network tests end to end: compile, network up, wait for DUST, `test:local`, network down.
- `mnkit deploy [name]` deploys to local, preview or preprod without the UI, and records the address in `deployments/<network>.json`.
- `mnkit doctor` checks the machine, and with `--network <net>` checks the network's node, indexer and proof server.
- `mnkit add ui` adds a browser UI as a workspace, and `mnkit add contract <name>` adds another contract.
- `mnkit upgrade` moves a project to the current templates and toolchain with a three-way merge (`--check`, `--force`).
- `@midnightntwrk/mnkit-wallet` (`MidnightWalletProvider`, wallet state saved after each sync on a remote network and restored on the next build, `fundWallet`, `waitForDust`), `@midnightntwrk/mnkit-sim` and `@midnightntwrk/mnkit-coins`.

### Toolchain

- Generated projects are on the Ledger 9 stack: Compact compiler 0.36.0 (language 0.28), Midnight.js 5.0.0 (`midnight-js-network-id` 5.0.0-rc.5), testkit-js 5.0.0, wallet SDK 2.0.0 (`@midnightntwrk/wallet-sdk`), proof server 9.0.0. The examples, their UIs and mnkit now share one set of pins in `toolchain.json`.
- Pre-seed fast sync is disabled until it is ported to wallet SDK 2: a `fastSync` option is accepted and ignored, and `preseed:cut` refuses to run. See FAST-SYNC.md.
- `mnkit validate` and the other local-network steps need a local devnet that runs Ledger 9. The pinned `compose.yml` images (node 2.1.0-rc.4, indexer 4.4.0-rc.6) don't yet, so CI runs mnkit's end-to-end test without the devnet for now.
