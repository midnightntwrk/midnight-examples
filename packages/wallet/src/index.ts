// Shared wallet plumbing for every example: the repo-root `.env` of test wallets,
// fast-sync pre-seeding, and the NIGHT → DUST funding gate for remote networks.
// See README.md in this package.

export type { WalletSecret } from './secret.js';
export {
  ENV_FILE,
  REFERENCE_ROOT,
  WALLET_SLOTS,
  loadRootEnv,
  localSeed,
  resolveWallet,
  walletEnvKeys,
  type ResolveWalletOptions,
  type ResolvedWallet,
  type WalletSource,
} from './env.js';
export {
  assembleWallet,
  getChainTipHeight,
  type AssembledWallet,
  type FastSyncOptions,
} from './fast-sync/fast-wallet.js';
export { ensureFunded, fundWallets, waitForDust, type FundableWallet } from './funding.js';
