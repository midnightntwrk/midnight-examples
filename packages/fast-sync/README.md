# @midnight-ntwrk/mnkit-wallet

Test wallets for Midnight projects. Part of
[mnkit](https://www.npmjs.com/package/mnkit), whose devnet tests and
`wait:dust` script build their wallet with it.

- `MidnightWalletProvider`, `syncWallet`: a `MidnightProvider` and
  `WalletProvider` over the wallet SDK's `WalletFacade`, built from a seed or
  mnemonic.
- `resolveWallet(network, role?)`: the wallet a suite runs as. Locally, the
  genesis-funded seeds. On preview or preprod, `MIDNIGHT_<NETWORK>_<ROLE>_SEED`
  (or `_MNEMONIC`) from the environment.
- `waitForDust`, `waitForNightThenDust`: block until the wallet can pay fees.
- `getConfig`, `LOCAL_CONFIG`, `PREVIEW_CONFIG`, `preprodConfig`: network
  endpoints.
- Pre-seed fast sync (`assembleWallet`, `findReferenceRoot`): restore a new
  wallet from a reference bundle instead of syncing from genesis. Point
  `MIDNIGHT_PRESEED_DIR` at a bundle directory to use it. For development
  wallets only.

Apache-2.0. Source: [midnight-examples/packages/fast-sync](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/fast-sync).
