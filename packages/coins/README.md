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

Apache-2.0. Source: [midnight-examples/packages/coins](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/coins).
