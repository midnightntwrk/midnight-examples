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

// Deploys one contract to the network in MIDNIGHT_NETWORK (local, preview or
// preprod), without the UI or the test suite:
//
// @if monorepo
//   npm run deploy [contract]           # local; deploy:preview, deploy:preprod
// @endif
// @if standalone
//   npx mnkit deploy [contract] [--network preprod]
// @endif
//
// The contract defaults to __name__. Its constructor arguments and initial
// private state come from contract/deploy-args.ts. The address and tx land in
// deployments/<network>.json. The private state and the contract's signing
// key (needed to maintain the contract later) are kept, encrypted, in
// .mnkit/private-state/<network>: back that directory up for a real network.
//
// Off local the wallet is the Alice wallet (MIDNIGHT_<NETWORK>_SEED), and the
// store's password is MIDNIGHT_PRIVATE_STATE_PASSWORD, checked against the
// private-state store's policy before anything is spent. Both come from the
// environment or the env files the devnet tests read: .env, .env.local,
// .env.<network> and .env.<network>.local. A proof server must be running
// (`npm run proof:up`), on every network.

import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { deployContract, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  MidnightWalletProvider,
  resolveWallet,
  syncWallet,
  waitForDust,
  waitForNightThenDust,
} from '@midnight-ntwrk/mnkit-wallet';
import { buildProviders, type __Name__Providers } from '../src/providers.js';
import {
  DEPLOY_NETWORKS,
  readDeployments,
  writeDeployment,
  type DeployContext,
  type DeployNetwork,
} from '../src/deployments.js';
import { deployables } from '../contract/deploy-args.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// Only for the local devnet, whose wallets and state are throwaway.
const LOCAL_PASSWORD = 'Mnkit-Local-Deploy-Only!';

// @if monorepo
const ENV_DIR = new URL('../../../', import.meta.url);
// @endif
// @if standalone
const ENV_DIR = new URL('../', import.meta.url);
// @endif

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

function fail(message: string): never {
  logger.error(message);
  process.exit(1);
}

/** Loads the env files the devnet tests read (vitest.config.ts); variables already set win. */
function loadNetworkEnv(network: string): void {
  for (const [key, value] of Object.entries(loadEnv(network, fileURLToPath(ENV_DIR), ''))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Whether anything answers HTTP at `url`. Any status counts: only a refused or timed-out connection fails. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
if (!(DEPLOY_NETWORKS as readonly string[]).includes(network)) {
  fail(`Can't deploy to '${network}'. Networks: ${DEPLOY_NETWORKS.join(', ')}.`);
}
const name = process.argv[2] ?? '__name__';
const entry = deployables[name];
if (!entry) fail(`contract/deploy-args.ts has no '${name}'. It has: ${Object.keys(deployables).join(', ')}.`);

const isRemote = network !== 'local';
if (isRemote) loadNetworkEnv(network);
const password = isRemote ? process.env['MIDNIGHT_PRIVATE_STATE_PASSWORD'] : LOCAL_PASSWORD;
const PASSWORD_POLICY =
  'at least 16 characters, with 3 of upper case, lower case, digits and symbols, no character more than 3 ' +
  "times in a row, and no runs like '1234' or 'abcd'";
if (!password) {
  fail(
    `Set MIDNIGHT_PRIVATE_STATE_PASSWORD (in .env.${network} or the environment). It encrypts the private ` +
      `state and signing key kept in .mnkit/private-state/${network}: ${PASSWORD_POLICY}. Keep it: without ` +
      'it the signing key is lost.',
  );
}
// The store checks it only after the deploy is on chain, so a weak one would
// spend DUST and then lose the signing key: check it first.
try {
  validatePassword(password);
} catch (err) {
  fail(
    `MIDNIGHT_PRIVATE_STATE_PASSWORD is too weak: ${err instanceof Error ? err.message : String(err)}. ` +
      `It needs ${PASSWORD_POLICY}. Nothing was deployed.`,
  );
}

// Imported only now: the network configs read the environment when they load.
const { getConfig } = await import('../src/config.js');
const config = getConfig();

if (!(await answers(config.proofServer))) {
  fail(`No proof server at ${config.proofServer}. Start one with \`npm run proof:up\` (or set MIDNIGHT_PROOF_SERVER).`);
}
if (!isRemote && !((await answers(config.node)) && (await answers(config.indexer)))) {
  fail('The local network is not running. Start it with `npm run env:up && npm run wait:dust`.');
}

setNetworkId(config.networkId);
const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };
// A wallet with no preseed syncs from genesis: about 78 minutes on preprod.
const syncTimeoutMs = Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 120 * 60_000 : 10 * 60_000));

const setup = resolveWallet(network);
const wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret, { fastSync: setup.fastSync });
await wallet.start();
try {
  await syncWallet(logger, wallet.wallet, syncTimeoutMs);
  if (isRemote) {
    // Synced is not funded: a wallet with no DUST fails its first submit.
    await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, envConfig, config.faucet, {
      label: setup.role,
    });
  } else {
    // A fresh devnet's genesis DUST is worth 0 until the first block after
    // genesis, and a deploy balanced before then fails ("could not balance dust").
    await waitForDust(logger, wallet.wallet, 1, syncTimeoutMs, config.indexer);
  }

  const providers: __Name__Providers = buildProviders(wallet, entry.zkConfigPath, config, {
    dbName: fileURLToPath(new URL(`../.mnkit/private-state/${network}`, import.meta.url)),
    storeName: '__name__-deploy',
    password,
  });
  const ctx: DeployContext = {
    network: network as DeployNetwork,
    deployments: readDeployments(network)?.contracts ?? {},
  };
  const withPrivateState = entry.privateStateId !== undefined;

  logger.info(`Deploying ${name} to '${network}'...`);
  // `entry` is typed per contract in deploy-args.ts; here it is any contract.
  const deployed = (await deployContract(providers, {
    compiledContract: entry.compiledContract,
    ...(entry.args ? { args: entry.args(ctx) } : {}),
    ...(withPrivateState ? { privateStateId: entry.privateStateId, initialPrivateState: entry.initialPrivateState } : {}),
  } as never)) as DeployedContract<any>;

  const tx = deployed.deployTxData.public;
  const file = writeDeployment(network, config.networkId, name, {
    address: tx.contractAddress,
    txId: tx.txId,
    txHash: tx.txHash,
    blockHeight: tx.blockHeight,
    blockHash: tx.blockHash,
    deployer: String(wallet.unshieldedKeystore.getBech32Address()),
    ...(withPrivateState ? { privateStateId: entry.privateStateId } : {}),
    deployedAt: new Date().toISOString(),
  });
  logger.info(`✔ ${name} deployed to '${network}' at ${tx.contractAddress} (block ${tx.blockHeight})`);
  logger.info(`  Recorded in ${file}`);
} catch (err) {
  logger.error(`deploy failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
} finally {
  await wallet.stop().catch((err: unknown) => logger.warn(`stop() failed: ${String(err)}`));
}
