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
  `MIDNIGHT_PRESEED_DIR` at a bundle directory to use it. A bundle is used only
  when its manifest, its parts, the indexer in use and the chain at its height
  all match; otherwise the wallet syncs from genesis. For development wallets
  only.

## Install outside mnkit

An mnkit project already has these. Anywhere else, install the peers at
exactly these versions and add the `overrides` to your `package.json`:

```sh
npm install --save-exact @midnight-ntwrk/mnkit-wallet \
  @midnight-ntwrk/midnight-js-network-id@4.1.1 @midnight-ntwrk/midnight-js-protocol@4.1.1 \
  @midnight-ntwrk/midnight-js-types@4.1.1 @midnight-ntwrk/midnight-js-utils@4.1.1 \
  @midnight-ntwrk/testkit-js@4.1.1 @midnight-ntwrk/wallet-sdk@1.2.0
```

```json
"overrides": {
  "@midnight-ntwrk/wallet-sdk": "1.2.0",
  "@midnight-ntwrk/ledger-v8": "8.1.2",
  "@midnight-ntwrk/onchain-runtime-v3": "3.1.1",
  "@midnight-ntwrk/zkir-v2": "2.1.1"
}
```

midnight-js 4.1.1 pins `ledger-v8` 8.1.0 and `onchain-runtime-v3` 3.0.0
exactly, and testkit-js 4.1.1 pins `wallet-sdk` 1.1.0 and `zkir-v2` 2.1.0.
Without the overrides you get those versions, which mnkit doesn't test, and
ledger-v8 8.1.0 lacks the 8.1.2 deserialization security fix. npm rejects an
override that differs from a direct dependency's range (`EOVERRIDE`), so
depend on `wallet-sdk` at exactly `1.2.0`.

Apache-2.0. Source: [midnight-examples/packages/fast-sync](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/fast-sync).
