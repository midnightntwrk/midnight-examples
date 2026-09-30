// Getting remote test wallets to the point where they can pay fees.
//
// A wallet can only pay a transaction fee in DUST, and DUST only accrues to NIGHT
// that has been registered for DUST generation. A freshly generated wallet has
// neither, so before a suite can deploy anything each wallet must:
//
//   1. receive NIGHT from the faucet (a human step — we print the address and wait),
//   2. register that NIGHT for DUST generation (a transaction, self-funded by the
//      registration's own DUST allowance), and
//   3. wait until spendable DUST has actually accrued.
//
// A wallet that already has spendable DUST skips all three, so re-runs with
// funded wallets pass straight through.

import type { UnshieldedKeystore, WalletFacade, FacadeState } from '@midnight-ntwrk/wallet-sdk';
import { type EnvironmentConfiguration, waitForFunds } from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

/** Anything with a facade and its unshielded keystore — e.g. an example's MidnightWalletProvider. */
export interface FundableWallet {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;
}

/** How long to wait for faucet NIGHT and for DUST to accrue (MIDNIGHT_FUND_TIMEOUT_MS). */
const FUND_TIMEOUT_MS = Number(process.env['MIDNIGHT_FUND_TIMEOUT_MS'] ?? 30 * 60_000);

function hasNight(s: FacadeState): boolean {
  return Object.values(s.unshielded.balances).some((v) => v > 0n);
}

/**
 * Block until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * "Synced" (isStrictlyComplete) means "caught up to chain tip", not "has
 * spendable funds" — a freshly registered wallet is at tip with zero DUST until
 * generation accrues. This waits for that.
 */
export async function waitForDust(
  logger: Logger,
  wallet: WalletFacade,
  minCoins = 1,
  timeoutMs = 180_000,
): Promise<void> {
  logger.info(`Waiting for ≥${minCoins} spendable DUST coin(s) (timeout ${timeoutMs}ms)...`);
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s: FacadeState) =>
        logger.info(`dust: ${s.dust.availableCoins.length} coin(s), balance ${s.dust.balance(new Date())} STAR`),
      ),
      Rx.filter((s: FacadeState) => s.dust.availableCoins.length >= minCoins),
      Rx.take(1),
      Rx.timeout({
        each: timeoutMs,
        with: () => Rx.throwError(() => new Error(`No spendable DUST coin within ${timeoutMs}ms`)),
      }),
    ),
  );
  logger.info('DUST ready.');
}

/**
 * Take one synced wallet from "whatever it holds" to "can pay fees": pause for
 * faucet NIGHT if it has none, register the NIGHT for DUST, then wait for DUST.
 */
export async function ensureFunded(
  logger: Logger,
  name: string,
  w: FundableWallet,
  env: EnvironmentConfiguration,
  timeoutMs = FUND_TIMEOUT_MS,
): Promise<void> {
  const state = await w.wallet.waitForSyncedState();
  if (state.dust.availableCoins.length > 0) {
    logger.info(`${name}: already holds spendable DUST.`);
    return;
  }

  const address = w.unshieldedKeystore.getBech32Address().asString();
  if (!hasNight(state)) {
    logger.info('────────────────────────────────────────────────────────────');
    logger.info(`${name} needs NIGHT — fund it at the faucet; the suite resumes once it arrives:`);
    logger.info(`  address: ${address}`);
    logger.info(`  faucet:  ${env.faucet}`);
    logger.info('────────────────────────────────────────────────────────────');
    await Rx.firstValueFrom(
      w.wallet.state().pipe(
        Rx.filter(hasNight),
        Rx.take(1),
        Rx.timeout({
          each: timeoutMs,
          with: () =>
            Rx.throwError(() => new Error(`${name}: no NIGHT at ${address} within ${timeoutMs}ms — fund it at ${env.faucet}`)),
        }),
      ),
    );
    logger.info(`${name}: NIGHT received.`);
  }

  // Registers the wallet's NIGHT UTxOs for DUST generation when it has no DUST
  // (a no-op for NIGHT that is already registered).
  logger.info(`${name}: registering NIGHT for DUST generation...`);
  await waitForFunds(w.wallet, env, false, w.unshieldedKeystore);
  await waitForDust(logger, w.wallet, 1, timeoutMs);
  logger.info(`${name}: ready to pay fees.`);
}

/**
 * `ensureFunded` for several wallets at once, keyed by display name, e.g.
 * `fundWallets(logger, env, { Alice: alice, Bob: bob })`. They run in parallel,
 * so every unfunded address is printed up front and can be funded in one go.
 */
export async function fundWallets(
  logger: Logger,
  env: EnvironmentConfiguration,
  wallets: Record<string, FundableWallet>,
  timeoutMs = FUND_TIMEOUT_MS,
): Promise<void> {
  await Promise.all(Object.entries(wallets).map(([name, w]) => ensureFunded(logger, name, w, env, timeoutMs)));
}
