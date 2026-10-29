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

// Fund a browser wallet (e.g. Lace) on the LOCAL devnet, for any example's ui/.
//
//   npm run fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]
//
// Runs from anywhere in the repo (root script). A generated UI's
// "no DUST" hint prints the exact command with this wallet's addresses. The
// work is fundWallet (src/fund-wallet.ts), which explains how it funds.

import pino from 'pino';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getConfig } from '../src/config.js';
import { fundWallet } from '../src/fund-wallet.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });

const args = process.argv.slice(2);
const dust = args.find((a) => a.startsWith('mn_dust_'));
const addr = args.find((a) => a.startsWith('mn_addr_'));
if (!dust) {
  logger.error('usage: npm run fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]');
  logger.error('A generated ui/ page prints this command, with your addresses, in its "no DUST" hint.');
  process.exit(1);
}

const config = getConfig();
if (config.networkId !== 'undeployed') {
  logger.error(`fund:wallet only targets the local devnet (MIDNIGHT_NETWORK=local), not ${config.networkId}`);
  process.exit(1);
}
const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };

try {
  await fundWallet(logger, envConfig, { dust, addr });
} catch (err) {
  logger.error(`fund-wallet failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
}
