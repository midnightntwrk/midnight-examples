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

// One call per wallet a test suite needs: build, start, sync, and on a remote
// network hold until it is funded.

import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import type { Logger } from 'pino';

import { waitForNightThenDust } from './funding.js';
import { resolveWallet } from './resolve.js';
import { MidnightWalletProvider, syncWallet } from './wallet-provider.js';

export interface StartWalletOptions {
  /** `local`, `preview`, `preprod`, ...: picks the seed and the funding gate. */
  network: string;
  /** The wallet to use (see resolveWallet). Defaults to ALICE. */
  role?: string;
  /** Faucet URL printed while a remote wallet waits for funds. */
  faucet: string;
  /** How long the first sync may take. */
  syncTimeoutMs: number;
}

/**
 * Build, start and sync the wallet for `role`, and on a remote network hold
 * until it has NIGHT and DUST (synced is not funded: a wallet with no DUST
 * fails its first submit). Call it once per wallet a suite needs:
 *
 *   const bob = await startWallet(logger, envConfig, { network, role: 'BOB', faucet, syncTimeoutMs });
 */
export async function startWallet(
  logger: Logger,
  env: EnvironmentConfiguration,
  { network, role, faucet, syncTimeoutMs }: StartWalletOptions,
): Promise<MidnightWalletProvider> {
  const setup = resolveWallet(network, role);
  const w = await MidnightWalletProvider.build(logger, env, setup.secret);
  await w.start();
  await syncWallet(logger, w.wallet, syncTimeoutMs);
  if (network !== 'local') {
    await waitForNightThenDust(logger, w.wallet, w.unshieldedKeystore, env, faucet, { label: setup.role });
  }
  return w;
}
