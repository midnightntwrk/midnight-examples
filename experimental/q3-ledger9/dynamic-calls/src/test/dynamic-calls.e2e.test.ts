// SOW-Q3-03 at L2: dynamic cross-contract calls on the local ledger 9 network
// through Midnight.js 5.0.0-rc.2 and its new contractModuleProvider, with real
// proofs. Vendor QA's dynamic-call cases ran on a pre-release Midnight.js build
// and skip on a clean install of the vendor harness, so this is the first run
// against a published Midnight.js.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleResolutionError, type ContractModuleProvider } from '@midnight-ntwrk/compact-runtime';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { buildProviders, initNetwork, startWallet, uniqueStore, type Providers } from '@q3/harness';
import {
  CompiledAuditedToken,
  CompiledStandardToken,
  CompiledTokenRegistry,
  auditedLedger,
  registryLedger,
  standardLedger,
} from '../../contract/index.js';
import { MANAGED, managedDir, ref } from '../modules.js';
import { discoverByVerifierKey, staticProvider } from '../module-providers.js';

const ALICE = new Uint8Array(32).fill(0xa1);
const BOB = new Uint8Array(32).fill(0xb0);
const SUPPLY = 1_000n;

/** Finds a ModuleResolutionError anywhere in a cause chain and returns its kind. */
function resolutionKind(e: unknown): string | undefined {
  for (let cur: unknown = e, depth = 0; cur && depth < 10; cur = (cur as { cause?: unknown }).cause, depth++) {
    if (ModuleResolutionError.is(cur)) return (cur as ModuleResolutionError).failure.kind;
  }
  return undefined;
}

describe('token_registry on the local ledger 9 network', () => {
  let wallet: MidnightWalletProvider;
  let std: string;
  let aud: string;
  let registry: string;

  const providersFor = (name: Parameters<typeof managedDir>[0], contractModuleProvider?: ContractModuleProvider) =>
    buildProviders(wallet, {
      managedDir: managedDir(name),
      storeName: uniqueStore(name),
      artifactRoot: MANAGED,
      ...(contractModuleProvider ? { contractModuleProvider } : {}),
    });

  const callRegistry = async (moduleProvider: ContractModuleProvider | undefined, circuitId: string, ...args: unknown[]) =>
    submitCallTx(await providersFor('token_registry', moduleProvider), {
      compiledContract: CompiledTokenRegistry,
      contractAddress: registry,
      circuitId,
      args,
    } as never);

  let reader: Providers;
  const stateOf = async (address: string) => (await reader.publicDataProvider.queryContractState(address))!.data;

  beforeAll(async () => {
    initNetwork();
    wallet = await startWallet('ALICE');
    reader = await providersFor('token_registry');

    const addressOf = (d: { deployTxData: { public: { contractAddress: string } } }) => d.deployTxData.public.contractAddress;
    std = addressOf(await deployContract(await providersFor('standard_token'), { compiledContract: CompiledStandardToken, args: [ALICE, SUPPLY] }));
    aud = addressOf(await deployContract(await providersFor('audited_token'), { compiledContract: CompiledAuditedToken, args: [BOB, SUPPLY] }));
    registry = addressOf(await deployContract(await providersFor('token_registry'), { compiledContract: CompiledTokenRegistry }));

    // Listing stores a contract reference; it makes no cross-contract call.
    await callRegistry(undefined, 'list', 1n, ref(std));
    await callRegistry(undefined, 'list', 2n, ref(aud));
  });

  afterAll(async () => {
    await wallet?.stop();
  });

  it('03-G6: discovers each listed address\'s implementation from its on-chain verifier keys', async () => {
    const { bindings } = await discoverByVerifierKey([std, aud], (a) => reader.publicDataProvider.queryContractState(a));
    expect(bindings).toEqual({ [std]: 'standard_token', [aud]: 'audited_token' });
  });

  it('AC-1: the same `pay` call site runs standard code for id 1 and audited code for id 2', async () => {
    const { provider } = await discoverByVerifierKey([std, aud], (a) => reader.publicDataProvider.queryContractState(a));

    await callRegistry(provider, 'pay', 1n, ALICE, BOB, 10n);
    expect(standardLedger(await stateOf(std)).balances.lookup(BOB)).toBe(10n);

    await callRegistry(provider, 'pay', 2n, BOB, ALICE, 5n);
    const a = auditedLedger(await stateOf(aud));
    expect(a.balances.lookup(ALICE)).toBe(5n);
    expect(a.audited_transfers).toBe(1n);
    expect(registryLedger(await stateOf(registry)).payments).toBe(2n);
  });

  it('03-G7: swap calls both implementations in one transaction', async () => {
    const provider = staticProvider({ [std]: 'standard_token', [aud]: 'audited_token' });
    await callRegistry(provider, 'swap', 1n, 2n, ALICE, BOB, 100n, 40n);
    expect(standardLedger(await stateOf(std)).balances.lookup(BOB)).toBe(110n);
    const a = auditedLedger(await stateOf(aud));
    expect(a.balances.lookup(ALICE)).toBe(45n);
    expect(a.audited_transfers).toBe(2n);
  });

  it.each([
    ['03-G1', 'ModuleProviderAbsent', () => undefined],
    ['03-G2', 'UnsupportedImplementation', () => staticProvider({ [std]: 'standard_token' })],
    ['03-G3', 'ImplementationMismatch', () => staticProvider({ [std]: 'standard_token', [aud]: 'standard_token' })],
  ] as Array<[string, string, () => ContractModuleProvider | undefined]>)('%s: pay to the audited token fails with %s', async (_gap, kind, provider) => {
    const err = await callRegistry(provider(), 'pay', 2n, BOB, ALICE, 1n).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err, 'the call should have been refused').toBeDefined();
    expect(resolutionKind(err), String(err)).toBe(kind);
  });
});
