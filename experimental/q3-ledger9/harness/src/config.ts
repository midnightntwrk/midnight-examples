// Network configuration for the local ledger 9 network in ../compose.yml.
//
// Ports default to the offset host ports in compose.yml and can be overridden
// with Q3_NODE_PORT / Q3_INDEXER_PORT / Q3_PROOF_PORT, e.g. to point the suite
// at a vendor-run stack.
import { NetworkId } from '@midnightntwrk/wallet-sdk';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const NODE = port('Q3_NODE_PORT', 19944);
const INDEXER = port('Q3_INDEXER_PORT', 18088);
const PROOF = port('Q3_PROOF_PORT', 16300);

export const NETWORK_ID = 'undeployed';

export const LOCAL_ENV: EnvironmentConfiguration = {
  walletNetworkId: NetworkId.NetworkId.Undeployed,
  networkId: NETWORK_ID,
  indexer: `http://127.0.0.1:${INDEXER}/api/v4/graphql`,
  indexerWS: `ws://127.0.0.1:${INDEXER}/api/v4/graphql/ws`,
  node: `http://127.0.0.1:${NODE}`,
  nodeWS: `ws://127.0.0.1:${NODE}`,
  proofServer: `http://127.0.0.1:${PROOF}`,
  faucet: undefined,
};

// Genesis-funded master seeds of the `undeployed` chainspec (CFG_PRESET=dev).
// testkit-js LocalTestEnvironment uses the same four.
export const GENESIS_SEEDS = {
  ALICE: '0000000000000000000000000000000000000000000000000000000000000001',
  BOB: '0000000000000000000000000000000000000000000000000000000000000002',
  CHARLIE: '0000000000000000000000000000000000000000000000000000000000000003',
} as const;
export type Role = keyof typeof GENESIS_SEEDS;
