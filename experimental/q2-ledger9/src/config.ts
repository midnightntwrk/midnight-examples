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
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
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

// Preprod goes through Blockfrost: the Midnight-hosted preprod indexer and RPC
// are shut down. Blockfrost rejects every request without a project token, and
// the SDK's indexer, wallet and node clients only take URLs, so the token rides
// along as a `project_id` query parameter. It is read from
// BLOCKFROST_PROJECT_ID (set it in the gitignored .env.preprod in this
// directory) and must never be written into a source file.
// Same pattern as packages/fast-sync/src/config.ts.
export function withBlockfrostKey(url: string, projectId: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}project_id=${encodeURIComponent(projectId)}`;
}

// Built on demand rather than at import time so it sees the env that vitest
// loads from .env.preprod.
export function preprodConfig(): NetworkConfig {
  const projectId = process.env['BLOCKFROST_PROJECT_ID']?.trim();
  if (!projectId) {
    throw new Error(
      'BLOCKFROST_PROJECT_ID is not set. Add it to experimental/q2-ledger9/.env.preprod ' +
        '(gitignored) or export it in your shell.',
    );
  }
  return {
    networkId: 'preprod',
    indexer: withBlockfrostKey('https://midnight-preprod.blockfrost.io/api/v0', projectId),
    indexerWS: withBlockfrostKey('wss://midnight-preprod.blockfrost.io/api/v0/ws', projectId),
    node: withBlockfrostKey('https://rpc.midnight-preprod.blockfrost.io', projectId),
    nodeWS: withBlockfrostKey('wss://rpc.midnight-preprod.blockfrost.io', projectId),
    proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  };
}

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
  if (network === 'preprod') return preprodConfig();
  if (network === 'stagenet') return STAGENET_CONFIG;
  throw new Error(
    `Unknown network: ${network}. Supported: 'local', 'preview', 'preprod', 'stagenet'.`,
  );
}
