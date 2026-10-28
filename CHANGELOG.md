# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## mnkit 0.2.0 (unreleased)

The first npm release of `mnkit` and its runtime packages `@midnight-ntwrk/mnkit-wallet`, `@midnight-ntwrk/mnkit-sim` and `@midnight-ntwrk/mnkit-coins`. All four share one version. `0.2.0-rc.1` goes to the `next` dist-tag first.

### Added

- `mnkit init <dir>` scaffolds a standalone npm project around your own Compact contract, with an `mnkit.json` manifest that makes it upgradable.
- `mnkit compile` compiles every contract with the pinned compiler, installing the pinned compiler or Compact CLI when it's missing (`--no-install` opts out).
- `mnkit derive` fills the generated stub regions from the compiled contract.
- `mnkit validate` runs the local-network tests end to end: compile, network up, wait for DUST, `test:local`, network down.
- `mnkit deploy [name]` deploys to local, preview or preprod without the UI, and records the address in `deployments/<network>.json`.
- `mnkit doctor` checks the machine, and with `--network <net>` checks the network's node, indexer and proof server.
- `mnkit add ui` adds a browser UI as a workspace, and `mnkit add contract <name>` adds another contract.
- `mnkit upgrade` moves a project to the current templates and toolchain with a three-way merge (`--check`, `--force`).
- `@midnight-ntwrk/mnkit-wallet` (wallet sync with preseed bundles, `MidnightWalletProvider`, `fundWallet`, `waitForDust`), `@midnight-ntwrk/mnkit-sim` and `@midnight-ntwrk/mnkit-coins`.
