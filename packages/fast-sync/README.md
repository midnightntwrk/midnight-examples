# @midnightntwrk/mnkit-wallet

Test wallets for Midnight projects. Part of
[mnkit](https://www.npmjs.com/package/mnkit), whose devnet tests and
`wait:dust` script build their wallet with it.

- `MidnightWalletProvider`, `syncWallet`: a Midnight.js 5 `Ledger9WalletProvider`
  over the wallet SDK's `WalletFacade`, built from a seed or mnemonic. On
  preview or preprod, `syncWallet` saves the wallet's state to `.wallet-state/`
  (gitignored; `MIDNIGHT_WALLET_STATE_DIR` moves it, `MIDNIGHT_WALLET_STATE=off`
  turns it off) and the next build of the same wallet restores it, so only the
  blocks since the last run are synced. Each save records the indexer's host and
  its tip (height and block hash), and a restore first checks that block still
  has that hash on that indexer. A network reset can keep the genesis hash, and
  indexers number events differently (Blockfrost's preprod ids run 22 behind
  the official indexer's), so a state from another chain or indexer is not
  restored: the wallet syncs from genesis and the next save replaces the file.
  A new wallet (and `assembleWallet`) turns on the wallet SDK's
  `skipLedgerV8DustHistory`, so on a chain that crossed the Ledger 9 fork in
  place (preprod, preview) its first sync skips the Ledger 8 DUST history:
  about 6 minutes on preprod instead of about 70.
- `resolveWallet(network, role?)`: the wallet a suite runs as. Locally, the
  genesis-funded seeds. On preview or preprod, `MIDNIGHT_<NETWORK>_<ROLE>_SEED`
  (or `_MNEMONIC`) from the environment.
- `waitForDust`, `waitForNightThenDust`: block until the wallet can pay fees
  (at least 60 DUST on a remote network; `MIDNIGHT_MIN_DUST` changes it).
- `getConfig`, `LOCAL_CONFIG`, `PREVIEW_CONFIG`, `preprodConfig`: network
  endpoints.
- `readChainStamp`, `checkChainStamp`: the chain check above, for your own
  saved state.

## Install outside mnkit

An mnkit project already has these. Anywhere else, install the peers at
exactly these versions and add the `overrides` to your `package.json`:

```sh
npm install --save-exact @midnightntwrk/mnkit-wallet \
  @midnight-ntwrk/midnight-js-protocol@5.0.1 \
  @midnight-ntwrk/midnight-js-types@5.0.1 @midnight-ntwrk/midnight-js-utils@5.0.1 \
  @midnight-ntwrk/testkit-js@5.0.1 @midnightntwrk/wallet-sdk@2.0.1
```

```json
"overrides": {
  "@midnightntwrk/wallet-sdk": "2.0.1",
  "@midnightntwrk/ledger-v9": "1.0.2",
  "@midnightntwrk/onchain-runtime-v4": "4.0.2",
  "@midnightntwrk/zkir-v3": "3.2.1"
}
```

Midnight.js 5.0.1 and testkit-js 5.0.1 pin these Ledger 9 packages at these
versions today, but compact-runtime 0.21.0 asks for `onchain-runtime-v4`
`^4.0.0-rc.3`. The overrides keep a later release, which mnkit doesn't
test, out of your tree. npm rejects an override that differs from a direct
dependency's range (`EOVERRIDE`), so depend on `wallet-sdk` at exactly
`2.0.1`.

Apache-2.0. Source: [midnight-examples/packages/fast-sync](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/fast-sync).
