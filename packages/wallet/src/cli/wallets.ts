// `yarn wallets <preview|preprod>` — fill the repo-root `.env` with the three
// shared test wallets for a network and print what to fund.
//
// Missing slots are generated with their birthday recorded (so they fast-sync);
// slots already in the file are left untouched. Running this up front means the
// test suites never stop to generate a wallet, and you can fund all three
// addresses at the faucet in one sitting before running any example.

import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk/unshielded';
import { ENV_FILE, resolveWallet, WALLET_SLOTS } from '../env.js';

// Only what this script needs: where to read the chain tip, and where to fund.
// The examples' own src/config.ts files carry the full endpoint sets.
const NETWORKS: Record<string, { indexer: string; faucet: string }> = {
  preview: {
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  },
  preprod: {
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  },
};

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });

const networkId = process.argv[2] ?? process.env['MIDNIGHT_NETWORK'];
const network = networkId ? NETWORKS[networkId] : undefined;
if (!networkId || !network) {
  console.error(`Usage: yarn wallets <${Object.keys(NETWORKS).join('|')}>`);
  process.exit(1);
}
setNetworkId(networkId);

const rows: string[] = [];
for (let slot = 1; slot <= WALLET_SLOTS; slot++) {
  const w = await resolveWallet(logger, { networkId, indexer: network.indexer }, slot);
  const seeds = w.secret.kind === 'mnemonic' ? WalletSeeds.fromMnemonic(w.secret.value) : WalletSeeds.fromMasterSeed(w.secret.value);
  const address = createKeystore(seeds.unshielded, networkId).getBech32Address().asString();
  const sync = w.fastSync ? `fast-sync (birthday ${w.birthday})` : 'full sync (no birthday)';
  rows.push(`  wallet ${slot}  ${address}  ${sync}${w.source === 'generated' ? '  [new]' : ''}`);
}

console.log(`\n${networkId} wallets in ${ENV_FILE}:\n${rows.join('\n')}`);
console.log(`\nFund each address with tNIGHT at ${network.faucet}`);
console.log('The test suites register the NIGHT for DUST and wait for it to accrue.\n');
