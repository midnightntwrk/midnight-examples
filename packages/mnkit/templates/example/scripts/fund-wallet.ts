// This file is part of example-__name__.
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
// Fund a browser wallet (e.g. Lace) on the local devnet, so the UI (`mnkit add
// ui`) can deploy and call:
//
//   npm run fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]
//
// The UI's "no DUST" hint prints this command with the wallet's addresses.
// fundWallet (@midnightntwrk/mnkit-wallet) has the genesis wallet register
// NIGHT for DUST generation with the browser wallet as the receiver, and with
// the mn_addr_… address also sends it 1,000 NIGHT. Safe to rerun.

import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { fundWallet } from '@midnightntwrk/mnkit-wallet';
import { getConfig } from '../src/config.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const args = process.argv.slice(2);
const dust = args.find((a) => a.startsWith('mn_dust_'));
const addr = args.find((a) => a.startsWith('mn_addr_'));
if (!dust) {
  logger.error('usage: npm run fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]');
  process.exit(1);
}

const config = getConfig();
if (config.networkId !== 'undeployed') {
  logger.error(`fund:wallet only targets the local devnet (MIDNIGHT_NETWORK=local), not ${config.networkId}`);
  process.exit(1);
}
setNetworkId(config.networkId);
const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };

try {
  await fundWallet(logger, envConfig, { dust, addr });
} catch (err) {
  logger.error(`fund-wallet failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
}
