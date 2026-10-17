// Shielded-coin helpers for the examples' tests: token colors, fresh coins as
// circuit arguments, a wallet's coins and balances and waiting for them, the
// arguments a mint to another wallet needs, and the tree index of a coin a
// contract received. See src/coins.ts.

export {
  contractCoinMtIndex,
  domainSeparator,
  encryptionKeys,
  freshCoin,
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
  type TxWithOutputs,
} from './coins.js';
