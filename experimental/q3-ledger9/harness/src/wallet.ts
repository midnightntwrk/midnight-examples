// Ledger 9 wallet for the acceptance tests.
//
// testkit-js 5 ships a MidnightWalletProvider that already speaks the
// Midnight.js 5 seams: it declares supportedEras ['v8','v9'], balances a
// version-tagged unbound transaction (adopt -> balanceUnboundTransaction ->
// signRecipe -> finalizeRecipe) and submits a version-tagged finalized one. It
// is both the walletProvider and the midnightProvider. We reuse it rather than
// port mn-examples' wallet SDK 1.x harness (packages/fast-sync), whose internals
// did not survive the 2.0 move.
import { MidnightWalletProvider, syncWallet } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';
import { GENESIS_SEEDS, LOCAL_ENV, type Role } from './config.js';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const SYNC_TIMEOUT_MS = Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? 10 * 60_000);

/**
 * Builds, starts and syncs a genesis-funded wallet. `start(true)` runs testkit's
 * waitForFunds, which also registers NIGHT UTXOs for DUST generation when the
 * wallet holds no DUST, so a fresh devnet wallet can pay fees.
 */
export async function startWallet(role: Role): Promise<MidnightWalletProvider> {
  const wallet = await MidnightWalletProvider.build(logger, LOCAL_ENV, GENESIS_SEEDS[role]);
  await wallet.start(true);
  await syncWallet(wallet.wallet, 1_000, SYNC_TIMEOUT_MS);
  return wallet;
}

export { MidnightWalletProvider, syncWallet };
