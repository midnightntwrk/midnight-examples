# @midnight-ntwrk/mnkit-coins

Shielded-coin helpers for Midnight tests. Part of
[mnkit](https://www.npmjs.com/package/mnkit); `mnkit derive` imports them
when a circuit takes a coin.

- `tokenColor(domain, contractAddress)`, `domainSeparator`: a minting
  contract's token color.
- `freshCoin(color, value)`: a new coin for a `ShieldedCoinInfo` circuit
  argument, with a random nonce. The wallet pays for it; never build one from
  the wallet's own coins.
- `simCoin(value, color)`: the same, for in-memory tests.
- `shieldedCoins`, `shieldedBalance`, `waitForShieldedBalance`: a wallet's
  coins and balances.
- `recipientOf`, `encryptionKeys`, `mintNonce`: the arguments a mint to
  another wallet needs.
- `contractCoinMtIndex`: a contract-held coin's tree index, from the indexer.

## Install outside mnkit

An mnkit project already has these. Anywhere else, add the peer and these
`overrides` to your `package.json`:

```json
"overrides": {
  "@midnight-ntwrk/ledger-v8": "8.1.2",
  "@midnight-ntwrk/onchain-runtime-v3": "3.1.1"
}
```

midnight-js-protocol 4.1.1 pins `ledger-v8` 8.1.0 and `onchain-runtime-v3`
3.0.0 exactly. Without the overrides you get those versions, which mnkit
doesn't test, and ledger-v8 8.1.0 lacks the 8.1.2 deserialization security
fix.

Apache-2.0. Source: [midnight-examples/packages/coins](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/coins).
