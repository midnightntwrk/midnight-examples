// The faucet funding gate for remote (preview/preprod) runs.
//
// "Synced" is not "funded". syncWallet's isStrictlyComplete() means the wallet
// has caught up to chain tip; a wallet that has never been funded is at tip
// with zero coins and fails its first submit with Wallet.InsufficientFunds.
//
// This blocks instead: it prints the address, waits for NIGHT to land from the
// faucet, registers that NIGHT for DUST generation, then waits again for
// spendable DUST to accrue (the registration self-funds from the DUST its own
// NIGHT generates, so that second wait is real).
//
// Lifted from examples/hello-world's test suite, which was the only place in
// the repo that did this, and generalized with `registerDust` for Dave.

import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { FacadeState, UnshieldedKeystore, WalletFacade } from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

/** How long to wait for a human to visit the faucet, and for DUST to accrue. */
export const FUND_TIMEOUT_MS = Number(process.env['MIDNIGHT_FUND_TIMEOUT_MS'] ?? 30 * 60_000);

function hasNight(s: FacadeState): boolean {
  return Object.values(s.unshielded.balances).some((v) => v > 0n);
}

/**
 * Block until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * Shared by the funding gate and each example's scripts/wait-for-dust.ts.
 */
export async function waitForDust(
  logger: Logger,
  wallet: WalletFacade,
  minCoins = 1,
  timeoutMs = 180_000,
): Promise<void> {
  logger.info(`Waiting for >=${minCoins} spendable DUST coin(s) (timeout ${timeoutMs}ms)...`);
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

export interface FundingGateOptions {
  /**
   * Register the wallet's NIGHT for DUST generation and wait for DUST.
   *
   * Pass false for Dave: the sponsorship suite needs a wallet that holds
   * tNIGHT but deliberately has NO DUST, because the whole point is that
   * Alice pays his fees. Registering him would break the suite's premise.
   */
  registerDust?: boolean;
  /** Label used in the log line, e.g. the role name. */
  label?: string;
}

/**
 * Hold until the wallet is usable on a remote network.
 *
 * Returns immediately once the wallet already has what it needs, so this is
 * cheap on every run after the first — the funding prompt only appears when
 * the wallet genuinely has no NIGHT.
 *
 * `envConfig` is unused since registration moved off testkit's waitForFunds;
 * it stays in the signature so the example suites' call sites don't change.
 */
export async function waitForNightThenDust(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
  envConfig: EnvironmentConfiguration,
  faucet: string,
  opts: FundingGateOptions = {},
): Promise<void> {
  const { registerDust = true, label = 'wallet' } = opts;
  const address = String(keystore.getBech32Address());

  // Peek at the current state to decide whether to prompt at all. Bounded:
  // if state() has not emitted yet we simply assume "not funded" and fall into
  // the wait below, which has its own timeout. An unbounded firstValueFrom here
  // would hang the whole beforeAll hook instead.
  const current = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (current === null || !hasNight(current)) {
    logger.info('────────────────────────────────────────────────────────────');
    logger.info(`Fund ${label} with NIGHT at the faucet — the suite resumes automatically once it arrives:`);
    logger.info(`  address: ${address}`);
    logger.info(`  faucet:  ${faucet}`);
    if (!registerDust) {
      logger.info('  NOTE: this wallet must NOT have DUST delegated — send tNIGHT only.');
    }
    logger.info('────────────────────────────────────────────────────────────');

    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter(hasNight),
        Rx.take(1),
        Rx.timeout({
          each: FUND_TIMEOUT_MS,
          with: () =>
            Rx.throwError(
              () => new Error(`No NIGHT at ${address} within ${FUND_TIMEOUT_MS}ms — fund it at ${faucet}`),
            ),
        }),
      ),
    );
  }

  if (!registerDust) {
    logger.info(`${label}: NIGHT present; skipping DUST registration by design.`);
    return;
  }

  logger.info(`${label}: NIGHT present; registering NIGHT->DUST generation...`);
  await registerNightForDust(logger, wallet, keystore);
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS);
  logger.info(`${label}: funded and ready.`);
}

// Register every not-yet-registered NIGHT UTXO for DUST generation, unless the
// wallet already holds DUST. This is what testkit's waitForFunds does, minus
// its strict syncWallet check (90 s, not configurable). That check needs the
// unshielded wallet's applied id to equal the indexer's latest
// UnshieldedTransactionsProgress.highestTransactionId. A new transaction moves
// the applied id at once, but the highest id only moves on the indexer's next
// progress poll. Current indexers (Blockfrost's among them) back that poll off
// to ~4 min on an idle subscription, so right after the faucet transfer the
// check times out even though the NIGHT is spendable. waitForDust below is the
// real readiness gate.
async function registerNightForDust(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
): Promise<void> {
  const state = await Rx.firstValueFrom(wallet.state());
  if (state.dust.balance(new Date()) > 0n) {
    logger.info('Wallet already holds DUST; skipping registration.');
    return;
  }
  const night = unshieldedToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.utxo.type === night && !coin.meta.registeredForDustGeneration,
  );
  if (unregistered.length === 0) {
    // Already registered (e.g. by an earlier run that died before DUST
    // accrued); waitForDust picks it up from here.
    logger.info('No unregistered NIGHT UTXOs; waiting for DUST from the existing registration.');
    return;
  }
  logger.info(`Registering ${unregistered.length} NIGHT UTXO(s) for DUST generation...`);
  const recipe = await wallet.registerNightUtxosForDustGeneration(
    unregistered,
    keystore.getPublicKey(),
    (payload) => keystore.signData(payload),
  );
  const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
  logger.info(`DUST registration tx submitted: ${txId}`);
}
