import { type MidnightProviders, type VersionedContractState } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type HelloWorldCircuits = 'storeMessage';

export type HelloWorldProviders = MidnightProviders<any>;

// How long a built transaction stays valid, in seconds (Midnight.js 5's
// `config.ttlSeconds`).
const TX_TTL_SECONDS = Number(process.env['MIDNIGHT_TX_TTL_SECONDS'] ?? 3600);

export function buildProviders(
    wallet: MidnightWalletProvider,
    zkConfigPath: string,
    config: NetworkConfig,
): HelloWorldProviders {
    const zkConfigProvider = new NodeZkConfigProvider<HelloWorldCircuits>(zkConfigPath);

    return {
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName: `hello-world-${Date.now()}`,
            privateStoragePasswordProvider: () => 'Hello-World-Test-Password',
            accountId: wallet.getCoinPublicKey(),
        }),
        publicDataProvider: indexerPublicDataProvider(
            config.indexer,
            config.indexerWS,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(
            config.proofServer,
            zkConfigProvider,
        ),
        walletProvider: wallet,
        midnightProvider: wallet,
        config: { networkId: config.networkId, ttlSeconds: TX_TTL_SECONDS },
    };
}

/**
 * The public ledger state of a contract read with queryContractState, for the
 * compiled `ledger()` to decode. Midnight.js 5 tags a contract state with the
 * ledger era that wrote it; every contract here is deployed on ledger 9.
 */
export function ledgerState(state: VersionedContractState | null) {
  if (state?.version !== 'v9') throw new Error('expected a ledger 9 contract state');
  return state.state.data;
}
