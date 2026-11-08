# @midnightntwrk/mnkit-wallet

Test wallets for Midnight projects. Part of
[mnkit](https://www.npmjs.com/package/mnkit), whose devnet tests and
`wait:dust` script build their wallet with it.

- `MidnightWalletProvider`, `syncWallet`: a Midnight.js 5 `Ledger9WalletProvider`
  over the wallet SDK's `WalletFacade`, built from a seed or mnemonic. On
  preview or preprod, `syncWallet` saves the wallet's state to `.wallet-state/`
  (gitignored; `MIDNIGHT_WALLET_STATE_DIR` moves it, `MIDNIGHT_WALLET_STATE=off`
  turns it off) and the next build of the same wallet restores it, so only the
  blocks since the last run are synced.
- `resolveWallet(network, role?)`: the wallet a suite runs as. Locally, the
  genesis-funded seeds. On preview or preprod, `MIDNIGHT_<NETWORK>_<ROLE>_SEED`
  (or `_MNEMONIC`) from the environment.
- `waitForDust`, `waitForNightThenDust`: block until the wallet can pay fees
  (at least 60 DUST on a remote network; `MIDNIGHT_MIN_DUST` changes it).
- `getConfig`, `LOCAL_CONFIG`, `PREVIEW_CONFIG`, `preprodConfig`: network
  endpoints.
- Pre-seed fast sync (`assembleWallet`, `findReferenceRoot`): **disabled on
  Ledger 9.** It restored a new wallet from a reference bundle by rewriting
  wallet SDK v1 snapshots, and wallet SDK 2 changed the snapshot format. Until
  it is ported, a `fastSync` option is accepted and ignored, every wallet syncs
  normally, and `preseed:cut` refuses to run. See FAST-SYNC.md.

## Install outside mnkit

An mnkit project already has these. Anywhere else, install the peers at
exactly these versions and add the `overrides` to your `package.json`:

```sh
npm install --save-exact @midnightntwrk/mnkit-wallet \
  @midnight-ntwrk/midnight-js-network-id@5.0.0-rc.5 @midnight-ntwrk/midnight-js-protocol@5.0.0 \
  @midnight-ntwrk/midnight-js-types@5.0.0 @midnight-ntwrk/midnight-js-utils@5.0.0 \
  @midnight-ntwrk/testkit-js@5.0.0 @midnightntwrk/wallet-sdk@2.0.0
```

```json
"overrides": {
  "@midnightntwrk/wallet-sdk": "2.0.0",
  "@midnightntwrk/ledger-v9": "1.0.0",
  "@midnightntwrk/onchain-runtime-v4": "4.0.0",
  "@midnightntwrk/zkir-v3": "3.2.0"
}
```

`midnight-js-network-id` has no 5.0.0 release, so it stays on 5.0.0-rc.5.
Midnight.js 5.0.0 and testkit-js 5.0.0 pin these Ledger 9 packages at these
versions today, but compact-runtime 0.21.0 asks for `onchain-runtime-v4`
`^4.0.0-rc.3`. The overrides keep a later release, which mnkit doesn't
test, out of your tree. npm rejects an override that differs from a direct
dependency's range (`EOVERRIDE`), so depend on `wallet-sdk` at exactly
`2.0.0`.

Apache-2.0. Source: [midnight-examples/packages/fast-sync](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/fast-sync).
