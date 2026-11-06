import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  buildWallet,
  getOrCreateTestWallet,
  resolveWallet,
  syncWallet,
  waitForFunding,
  type MidnightWalletProvider,
  type WalletSecret,
} from '../wallet.js';
import { buildProviders, ledgerState, type HelloWorldProviders } from '../providers.js';

// Where an auto-generated throwaway wallet is cached (gitignored). Only used
// when the root .env.<network> has no wallet for this network.
const WALLETS_DIR = fileURLToPath(new URL('../../.test-wallets', import.meta.url));
import {
  CompiledHelloWorldContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const PRIVATE_STATE_ID = 'AlicePrivateHWState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

interface WalletSetup {
  secret: WalletSecret;
  /** True when a fresh wallet was just generated and still needs funding. */
  isNew: boolean;
}

// Resolve the wallet for a run.
//
// Preferred: Alice from the repo-root .env.<network>. Failing that, generate a
// throwaway wallet, save it, and ask the developer to fund it, so hello-world
// still works as a zero-setup smoke test.
function resolveHelloWorldWallet(net: string, networkId: string): WalletSetup {
  const shared = resolveWallet(net);
  if (shared) {
    if (net !== 'local') logger.info(`Using ALICE from the root .env.${net}.`);
    return { secret: shared, isNew: false };
  }
  const { seed, isNew } = getOrCreateTestWallet(WALLETS_DIR, networkId);
  logger.info(
    isNew
      ? `Generated a new ${net} wallet; it syncs, then you are asked to fund it.`
      : `Reusing the saved ${net} wallet.`,
  );
  return { secret: { kind: 'seed', value: seed }, isNew };
}

describe(`Hello World Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: HelloWorldProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ??
      (isRemote ? 90 * 60_000 : 10 * 60_000),
  );

  async function queryLedger(p: HelloWorldProviders) {
    const state = await p.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(ledgerState(state));
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);

    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    const setup = resolveHelloWorldWallet(network, config.networkId);
    wallet = await buildWallet(logger, envConfig, setup.secret);
    await wallet.start(false);
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      // A freshly generated wallet holds no NIGHT. Block until the developer
      // funds it at the faucet, then until it has spendable DUST for fees.
      await waitForFunding(logger, wallet.wallet, wallet.unshieldedKeystore, envConfig, {
        label: 'hello-world wallet',
      });
    }

    providers = buildProviders(wallet, zkConfigPath, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  // Everything above is harness setup. Your tests begin here.

  it('Deploys the contract', async () => {
    logger.info(`Creating private state...`);

    const deployed: DeployedContract<Contract> =
      await deployContract(providers, {
        compiledContract: CompiledHelloWorldContract,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
      });

    logger.info(`Setting the contract address...`);
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await queryLedger(providers);
    expect(state.message).toEqual('');
  });

  it('Stores Hello World!', async () => {
    const message = 'Hello World!';

    await submitCallTx(providers, {
      compiledContract: CompiledHelloWorldContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'storeMessage',
      args: [message],
    });

    const state = await queryLedger(providers);
    expect(state.message).toEqual(message);
  });
});
