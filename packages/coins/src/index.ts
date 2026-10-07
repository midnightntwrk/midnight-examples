// Shielded-coin helpers for the examples' tests: token colors, a wallet's
// coins as circuit arguments, balances and waiting for them, and the
// arguments a mint to another wallet needs. See src/coins.ts.

export {
  domainSeparator,
  encryptionKeys,
  mintNonce,
  recipientOf,
  shieldedBalance,
  shieldedCoins,
  simCoin,
  takeCoin,
  tokenColor,
  waitForShieldedBalance,
  type CoinWallet,
  type ShieldedCoinArg,
  type ShieldedStateView,
  type TokenColor,
} from './coins.js';
