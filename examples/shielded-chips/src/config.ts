// This file is part of example-shielded-chips.
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

// The main purpose of this file is to hold network configurations. Add configs for new networks
// (such as Preprod) and modify the code in getConfig() to set `const network` appropriately
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

// depends on docker config in compose.yml running
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

// Preprod goes through Blockfrost. Blockfrost rejects every request without a
// project token, and the SDK's indexer, wallet and node clients only take URLs,
// so the token rides along as a `project_id` query parameter. It is read from
// BLOCKFROST_PROJECT_ID (set it in the gitignored repo-root .env.preprod) and
// must never be written into a source file.
function withBlockfrostKey(url: string, projectId: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}project_id=${encodeURIComponent(projectId)}`;
}

// Built on demand rather than at import time so it sees the env that vitest
// loads from .env.preprod.
export function preprodConfig(): NetworkConfig {
  const projectId = process.env['BLOCKFROST_PROJECT_ID']?.trim();
  if (!projectId) {
    throw new Error(
      'BLOCKFROST_PROJECT_ID is not set. Add it to the repo-root .env.preprod ' +
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

// A network that exists only in env: e.g. a private or short-lived network whose
// endpoints arrive late. Set these in the gitignored repo-root .env.custom (see
// .env.custom.example), or in the file named by MIDNIGHT_ENV_FILE, which is
// layered on top of it (vitest.config.ts). Built on demand so it sees that env.
export function customConfig(): NetworkConfig {
  const required = [
    'MIDNIGHT_NETWORK_ID',
    'MIDNIGHT_NODE',
    'MIDNIGHT_NODE_WS',
    'MIDNIGHT_INDEXER',
    'MIDNIGHT_INDEXER_WS',
  ] as const;
  const value = (name: string): string | undefined => process.env[name]?.trim() || undefined;
  const missing = required.filter((name) => value(name) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `MIDNIGHT_NETWORK=custom needs ${missing.join(', ')}. Set them in the repo-root ` +
        '.env.custom (see .env.custom.example), in the file named by MIDNIGHT_ENV_FILE, ' +
        'or in your shell.',
    );
  }
  return {
    networkId: value('MIDNIGHT_NETWORK_ID')!,
    indexer: value('MIDNIGHT_INDEXER')!,
    indexerWS: value('MIDNIGHT_INDEXER_WS')!,
    node: value('MIDNIGHT_NODE')!,
    nodeWS: value('MIDNIGHT_NODE_WS')!,
    proofServer: value('MIDNIGHT_PROOF_SERVER') ?? 'http://127.0.0.1:6300',
    faucet: value('MIDNIGHT_FAUCET') ?? '',
  };
}

export function getConfig(): NetworkConfig {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  switch (network) {
    case 'local':
      return LOCAL_CONFIG;
    case 'preview':
      return PREVIEW_CONFIG;
    case 'preprod':
      return preprodConfig();
    case 'custom':
      return customConfig();
    default:
      throw new Error(
        `Unknown network: ${network}. Supported: 'local', 'preview', 'preprod', 'custom'.`,
      );
  }
}
