// Shared test-wallet harness for running the examples against a remote
// Midnight network (preview / preprod).

export type { WalletSecret } from './types.js';
export {
  getConfig,
  LOCAL_CONFIG,
  PREVIEW_CONFIG,
  preprodConfig,
  redactUrl,
  withBlockfrostKey,
  type NetworkConfig,
} from './config.js';
export {
  assembleWallet,
  getChainTipHeight,
  type AssembledWallet,
  type SerializableSubWallet,
} from './fast-wallet.js';
export { checkChainStamp, getBlockHash, readChainStamp, type ChainStamp } from './chain-identity.js';
export {
  LOCAL_SEEDS,
  resolveWallet,
  type CanonicalRole,
  type ResolvedWallet,
} from './resolve.js';
export {
  FUND_TIMEOUT_MS,
  waitForDust,
  waitForNightThenDust,
  type FundingGateOptions,
} from './funding.js';
export { fundWallet, type FundWalletOptions } from './fund-wallet.js';
export { getOrCreateTestWallet, type PersistedWallet } from './test-wallet.js';
export { registerNightForDust, transferNight } from './local-funding.js';
export { MidnightWalletProvider, syncWallet } from './wallet-provider.js';
