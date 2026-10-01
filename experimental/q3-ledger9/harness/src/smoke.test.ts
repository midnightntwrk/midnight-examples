// Harness gate: a ledger 9 deploy, a proven call and an indexer read-back.
// Everything in signature-verify/ and dynamic-calls/ assumes this passes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledCounter, counterManagedDir, ledger } from '../contract/index.js';
import { buildProviders, initNetwork, startWallet, uniqueStore, type Providers } from './index.js';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';

describe('ledger 9 harness smoke', () => {
  let wallet: MidnightWalletProvider;
  let providers: Providers;

  beforeAll(async () => {
    initNetwork();
    wallet = await startWallet('ALICE');
    providers = await buildProviders(wallet, {
      managedDir: counterManagedDir,
      storeName: uniqueStore('smoke'),
    });
  });

  afterAll(async () => {
    await wallet?.stop();
  });

  it('deploys, calls and reads back through the indexer', async () => {
    const deployed = await deployContract(providers, { compiledContract: CompiledCounter });
    const address = deployed.deployTxData.public.contractAddress;
    expect(address).toMatch(/^[0-9a-f]+$/);

    await submitCallTx(providers, {
      compiledContract: CompiledCounter,
      contractAddress: address,
      circuitId: 'increment',
    });

    const state = await providers.publicDataProvider.queryContractState(address);
    expect(state).not.toBeNull();
    expect(ledger(state!.data).round).toBe(1n);
  });
});
