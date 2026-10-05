// This file is part of stagenet-q2 (adapted from example-usdcx).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

export type NetworkConfig = {
  networkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  nodeWS: string;
  proofServer: string;
  // Human-facing faucet page for topping up test wallets. Not a programmatic
  // drip endpoint — the tests assume seeds in .env.<network> are pre-funded.
  faucet: string;
};

export const LOCAL_CONFIG: NetworkConfig = {
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  faucet: '',
};

export const PREVIEW_CONFIG: NetworkConfig = {
  networkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
  faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
};

export const PREPROD_CONFIG: NetworkConfig = {
  networkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
  faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
};

// stagenet: the shielded-tech-operated 7-validator dev network on AWS EKS.
// Endpoints live on shielded.tools (not midnight.network). Runs the 2.x node
// line (specVersion 2_000_000) — matches this repo's midnight-node 2.0.0-rc.4
// / SDK 5.0.0-beta.6 pins. Endpoints per midnight-canary/api/src/network.ts.
export const STAGENET_CONFIG: NetworkConfig = {
  networkId: 'stagenet',
  indexer: 'https://indexer.stagenet.shielded.tools/api/v4/graphql',
  indexerWS: 'wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws',
  node: 'https://rpc.stagenet.shielded.tools',
  nodeWS: 'wss://rpc.stagenet.shielded.tools',
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
  faucet: 'https://faucet.stagenet.shielded.tools/',
};

export function getConfig(): NetworkConfig {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  if (network === 'local') return LOCAL_CONFIG;
  if (network === 'preview') return PREVIEW_CONFIG;
  if (network === 'preprod') return PREPROD_CONFIG;
  if (network === 'stagenet') return STAGENET_CONFIG;
  throw new Error(
    `Unknown network: ${network}. Supported: 'local', 'preview', 'preprod', 'stagenet'.`,
  );
}
