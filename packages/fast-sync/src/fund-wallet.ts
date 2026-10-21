// This file is part of mn-examples.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// fundWallet: fund a browser wallet (e.g. Lace) on the LOCAL devnet. Behind
// the repo's `yarn fund:wallet` (scripts/fund-wallet.ts) and a standalone
// project's `npm run fund:wallet`; a generated UI's "no DUST" hint prints the
// command with the wallet's addresses.
//
// Every tx pays its fee in DUST, a new wallet has none, and the local devnet
// has no faucet. DUST can't be transferred. It accrues from NIGHT that is
// registered for DUST generation, and registration can name any DUST address
// as the receiver. So:
//   1. The genesis wallet (Alice, seed 0…01; the only funded wallet on the
//      devnet) sends NIGHT to a throwaway "sponsor" wallet.
//   2. The sponsor registers that NIGHT for DUST generation with the browser
//      wallet's DUST address as receiver. From then on, DUST accrues to the
//      browser wallet without it signing anything.
// Alice's own NIGHT stays registered to Alice, so the test suites are
// unaffected. Never point this at Alice's NIGHT: re-registering it would
// redirect the suites' DUST.
//
// With an unshielded mn_addr_… address too, Alice also sends it 1,000 NIGHT.
// A contract that takes NIGHT from the user (private-party's checkIn) needs it.

import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import * as Rx from 'rxjs';
import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { DustAddress, MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';
import { assembleWallet, type AssembledWallet } from './fast-wallet.js';
import { waitForDust } from './funding.js';
import { registerNightForDust, transferNight } from './local-funding.js';
import { LOCAL_SEEDS } from './resolve.js';

const ALICE_SEED = LOCAL_SEEDS.ALICE;
// One throwaway sponsor per browser wallet, derived from its DUST address
// (local devnet only; distinct from the suites' 0…01–0…04 seeds). It has to be
// per wallet: a NIGHT key's DUST registration names one receiver, and NIGHT
// that reaches an already-registered key arrives registered to that same
// receiver. A single shared sponsor (as this script had in examples/hello-world)
// could only ever fund the first wallet, and hung on every later run waiting
// for an unregistered coin.
const sponsorSeed = (dust: string) =>
  createHash('sha256').update(`mn-examples fund:wallet sponsor for ${dust}`).digest('hex');
// NIGHT has 6 decimals: amounts on chain are in STAR (1 NIGHT = 1_000_000 STAR).
const STAR_PER_NIGHT = 1_000_000n;
// More registered NIGHT means DUST accrues faster and to a higher cap.
const SPONSOR_NIGHT = 100_000n * STAR_PER_NIGHT;
const WALLET_NIGHT = 1_000n * STAR_PER_NIGHT;
const SYNC_TIMEOUT_MS = 180_000;

export interface FundWalletOptions {
  /** The browser wallet's DUST address (mn_dust_undeployed1...). */
  dust: string;
  /** Its unshielded address (mn_addr_undeployed1...), to also send it 1,000 NIGHT. */
  addr?: string;
}

/**
 * Make DUST accrue to the `dust` address on the local devnet (and send `addr`
 * NIGHT). Safe to rerun: a wallet that already has a sponsor is left as is.
 * `envConfig` must be the local devnet's.
 */
export async function fundWallet(
  logger: Logger,
  envConfig: EnvironmentConfiguration,
  { dust: dustArg, addr: addrArg }: FundWalletOptions,
): Promise<void> {
  if (envConfig.walletNetworkId !== 'undeployed') {
    throw new Error(`fundWallet only targets the local devnet (undeployed), not ${envConfig.walletNetworkId}`);
  }
  const dustReceiver = MidnightBech32m.parse(dustArg).decode(DustAddress, envConfig.walletNetworkId);
  const nightRecipient = addrArg
    ? MidnightBech32m.parse(addrArg).decode(UnshieldedAddress, envConfig.walletNetworkId)
    : null;

  const strictlyComplete = (progress: unknown): boolean => {
    const p = progress as { isStrictlyComplete?: () => boolean } | null;
    return typeof p?.isStrictlyComplete === 'function' && p.isStrictlyComplete();
  };

  /**
   * Build, start and fully sync a wallet from a hex seed. "Fully" means all three
   * sub-wallets report isStrictlyComplete(), as the examples' syncWallet waits
   * for. Building a tx from a wallet that isn't there yet spends stale coins.
   */
  async function openWallet(label: string, seed: string): Promise<AssembledWallet> {
    const w = await assembleWallet(logger, envConfig, { kind: 'seed', value: seed });
    await w.facade.start(w.zswapSecretKeys, w.dustSecretKey);
    await Rx.firstValueFrom(
      w.facade.state().pipe(
        Rx.filter(
          (s) =>
            strictlyComplete(s.shielded.state.progress) &&
            strictlyComplete(s.unshielded.progress) &&
            strictlyComplete(s.dust.state.progress),
        ),
        Rx.take(1),
        Rx.timeout({
          each: SYNC_TIMEOUT_MS,
          with: () => Rx.throwError(() => new Error(`${label} wallet didn't sync within ${SYNC_TIMEOUT_MS}ms`)),
        }),
      ),
    );
    logger.info(`${label} wallet synced.`);
    return w;
  }

  const opened: AssembledWallet[] = [];
  try {
    const alice = await openWallet('Genesis', ALICE_SEED);
    opened.push(alice);
    const sponsor = await openWallet('Sponsor', sponsorSeed(dustArg));
    opened.push(sponsor);
    await waitForDust(logger, alice.facade, 1, SYNC_TIMEOUT_MS, envConfig.indexer);

    const nightCoins = (s: { unshielded: { availableCoins: readonly { utxo: { type: string } }[] } }) =>
      s.unshielded.availableCoins.filter((c) => c.utxo.type === nativeToken().raw).length;
    const sponsored = nightCoins(await sponsor.facade.waitForSyncedState()) > 0;
    if (sponsored) {
      // A rerun for the same wallet: its sponsor's NIGHT is already registered
      // to it, so DUST is already accruing. Nothing to do for DUST.
      logger.info(`This wallet already has a sponsor; DUST keeps accruing to ${dustArg}.`);
    } else {
      // 1. Fund the sponsor with NIGHT, and wait until it sees the new UTXO.
      const sponsorAddress = await sponsor.facade.unshielded.getAddress();
      logger.info(`Sending ${SPONSOR_NIGHT / STAR_PER_NIGHT} NIGHT from genesis to a new sponsor wallet...`);
      logger.info(`  tx: ${await transferNight(alice, sponsorAddress, SPONSOR_NIGHT)}`);
      await Rx.firstValueFrom(
        sponsor.facade.state().pipe(
          Rx.filter((s) => nightCoins(s) > 0),
          Rx.take(1),
          Rx.timeout({
            each: SYNC_TIMEOUT_MS,
            with: () => Rx.throwError(() => new Error(`the sponsor didn't receive the NIGHT within ${SYNC_TIMEOUT_MS}ms`)),
          }),
        ),
      );

      // 2. Register the sponsor's NIGHT, pointing its DUST at the browser wallet.
      logger.info(`Registering the sponsor's NIGHT for DUST generation -> ${dustArg}`);
      const regTx = await registerNightForDust(sponsor, dustReceiver);
      logger.info(regTx ? `  tx: ${regTx}` : '  nothing new to register');
    }

    if (nightRecipient) {
      await alice.facade.waitForSyncedState();
      logger.info(`Sending ${WALLET_NIGHT / STAR_PER_NIGHT} NIGHT from genesis to ${addrArg}...`);
      logger.info(`  tx: ${await transferNight(alice, nightRecipient, WALLET_NIGHT)}`);
    }

    logger.info('Done. DUST now accrues to the browser wallet; give it a few blocks, then deploy.');
  } finally {
    for (const w of opened.reverse()) {
      await w.facade.stop().catch((err: unknown) => logger.warn(`wallet stop() failed: ${String(err)}`));
    }
  }
}
