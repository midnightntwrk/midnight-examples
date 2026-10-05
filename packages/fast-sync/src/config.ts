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

// Preprod goes through Blockfrost: the official preprod indexer is no longer
// served. Blockfrost rejects every request without a project token, and the
// SDK's indexer, wallet and node clients only take URLs, so the token rides
// along as a `project_id` query parameter. It is read from
// BLOCKFROST_PROJECT_ID (set it in the gitignored repo-root .env.preprod) and
// must never be written into a source file.
//
// Blockfrost numbers ledger events and transactions differently from the
// official indexer, so a preseed bundle or saved wallet state is only valid on
// the indexer that produced it. See FAST-SYNC.md.
export function withBlockfrostKey(url: string, projectId: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}project_id=${encodeURIComponent(projectId)}`;
}

/** Strip the Blockfrost token from a URL so it can be logged or shown. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]project_id=)[^&]*/g, '$1<redacted>');
}

// Built on demand rather than at import time so it sees the env that vitest
// (or the caller's shell) loads from .env.preprod.
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

export function getConfig(network = process.env['MIDNIGHT_NETWORK'] ?? 'local'): NetworkConfig {
  if (network === 'local') return LOCAL_CONFIG;
  if (network === 'preview') return PREVIEW_CONFIG;
  if (network === 'preprod') return preprodConfig();
  throw new Error(
    `Unknown network: ${network}. Supported: 'local', 'preview', 'preprod'.`,
  );
}
