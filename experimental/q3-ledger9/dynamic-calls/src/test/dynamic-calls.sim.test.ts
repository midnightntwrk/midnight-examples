// SOW-Q3-03 at L1: dynamic cross-contract calls run entirely in memory
// (gap 03-G9), and every ModuleResolutionError kind a DApp can reach
// (03-G1..G5).
//
// The registry runs in the compact-runtime simulator with a `crossContract`
// option: a ContractStateProvider standing in for the chain (callee states by
// address) and a ContractModuleProvider (callee modules by address). The
// runtime then does what it does against a real chain: resolve the module,
// check it conforms to `contract Token { ... }`, compare its expectedVk with
// the verifier key deployed at the address, and only then run it.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ContractOperation,
  ModuleResolutionError,
  createConstructorContext,
  sampleContractAddress,
  type ContractModuleProvider,
  type ContractState,
} from '@midnight-ntwrk/compact-runtime';
import { bundledContractModuleProvider } from '@midnight-ntwrk/midnight-js-bundled-contract-module-provider';
import { outcome, SIM_COIN_PK, Simulator } from '@q3/harness/sim';
import { Contract as Registry, ledger as registryLedger } from '../../contract/managed/token_registry/contract/index.js';
import * as Standard from '../../contract/managed/standard_token/contract/index.js';
import * as Audited from '../../contract/managed/audited_token/contract/index.js';
import { loadModule, ref, verifierKey, type Implementation } from '../modules.js';
import { deferredProvider, discoverByVerifierKey } from '../module-providers.js';

const ALICE = new Uint8Array(32).fill(0xa1);
const BOB = new Uint8Array(32).fill(0xb0);
const SUPPLY = 1_000n;
const BLOCK = 'ab'.repeat(32);

// "Deploys" a token in memory: its constructor state plus the verifier key the
// compiler produced, which is what a real deploy puts on chain.
async function deployToken(impl: Implementation): Promise<{ address: string; state: ContractState }> {
  const C = impl === 'standard_token' ? Standard.Contract : Audited.Contract;
  const { currentContractState: state } = await new C({}).initialState(createConstructorContext(undefined, SIM_COIN_PK), ALICE, SUPPLY);
  const op = new ContractOperation();
  op.verifierKey = verifierKey(impl, 'transfer');
  state.setOperation('transfer', op);
  return { address: sampleContractAddress(), state };
}

interface World {
  std: { address: string; state: ContractState };
  aud: { address: string; state: ContractState };
  chain: Map<string, ContractState>;
}

async function world(): Promise<World> {
  const std = await deployToken('standard_token');
  const aud = await deployToken('audited_token');
  return { std, aud, chain: new Map([[std.address, std.state], [aud.address, aud.state]]) };
}

async function registry(w: World, moduleProvider?: ContractModuleProvider) {
  const sim = await Simulator.deploy<undefined>(new Registry({}) as never, undefined, [], {
    parentBlockHash: BLOCK,
    ...(moduleProvider
      ? {
          crossContract: {
            stateProvider: { getContractState: async (_block: string, address: string) => w.chain.get(address) },
            moduleProvider,
          },
        }
      : {}),
  });
  await sim.call('list', 1n, ref(w.std.address));
  await sim.call('list', 2n, ref(w.aud.address));
  return sim;
}

const bundled = (w: World, bindings: Record<string, keyof typeof loadModule>) =>
  bundledContractModuleProvider(new Map(Object.entries(bindings).map(([a, m]) => [a, loadModule[m]])));

/** The callee's ledger after the last call, read from the simulator context. */
const calleeState = (sim: Simulator<undefined>, address: string) => sim.lastContext.queryContexts[address].state;

async function failureKind(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    expect(ModuleResolutionError.is(e), `expected a ModuleResolutionError, got: ${e}`).toBe(true);
    return (e as ModuleResolutionError).failure.kind;
  }
  throw new Error('expected the call to fail');
}

describe('AC-1: one call site, the implementation deployed at each address', () => {
  let w: World;
  beforeEach(async () => (w = await world()));

  it('pay runs standard_token code for id 1 and audited_token code for id 2', async () => {
    const sim = await registry(w, bundled(w, { [w.std.address]: 'standard_token', [w.aud.address]: 'audited_token' }));

    expect(await sim.call('pay', 1n, ALICE, BOB, 10n)).toBe(990n);
    expect(Standard.ledger(calleeState(sim, w.std.address)).balances.lookup(BOB)).toBe(10n);

    expect(await sim.call('pay', 2n, ALICE, BOB, 25n)).toBe(975n);
    // Only the audited implementation has this counter: proof that different
    // code ran from the same call site.
    expect(Audited.ledger(calleeState(sim, w.aud.address)).audited_transfers).toBe(1n);
    expect(registryLedger(sim.state).payments).toBe(2n);
  });

  it('03-G7: swap runs both implementations inside one circuit execution', async () => {
    // Give BOB audited tokens first so he can pay his side of the swap.
    w.aud.state = (await (async () => {
      const C = Audited.Contract;
      const { currentContractState } = await new C({}).initialState(createConstructorContext(undefined, SIM_COIN_PK), BOB, SUPPLY);
      const op = new ContractOperation();
      op.verifierKey = verifierKey('audited_token', 'transfer');
      currentContractState.setOperation('transfer', op);
      return currentContractState;
    })());
    w.chain.set(w.aud.address, w.aud.state);
    const sim = await registry(w, bundled(w, { [w.std.address]: 'standard_token', [w.aud.address]: 'audited_token' }));

    await sim.call('swap', 1n, 2n, ALICE, BOB, 100n, 40n);
    const ctx = sim.lastContext;
    expect(Standard.ledger(ctx.queryContexts[w.std.address].state).balances.lookup(BOB)).toBe(100n);
    expect(Audited.ledger(ctx.queryContexts[w.aud.address].state).balances.lookup(ALICE)).toBe(40n);
    expect(Audited.ledger(ctx.queryContexts[w.aud.address].state).audited_transfers).toBe(1n);
  });
});

describe('ModuleResolutionError kinds a DApp can reach', () => {
  let w: World;
  beforeEach(async () => (w = await world()));

  it('03-G1 ModuleProviderAbsent: no module provider at all', async () => {
    // Without crossContract the runtime has no provider to ask. A DApp that
    // made cross-contract calls before 0.35 and never registered one lands here.
    const sim = await Simulator.deploy<undefined>(new Registry({}) as never, undefined, [], { parentBlockHash: BLOCK });
    await sim.call('list', 1n, ref(w.std.address));
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('ModuleProviderAbsent');
  });

  it('03-G2 UnsupportedImplementation: the provider has no binding for the address', async () => {
    const sim = await registry(w, bundled(w, { [w.std.address]: 'standard_token' }));
    expect(await failureKind(() => sim.call('pay', 2n, ALICE, BOB, 1n))).toBe('UnsupportedImplementation');
  });

  it('03-G3 ImplementationMismatch: standard module bound to the audited address', async () => {
    // Both modules CONFORM to `Token` (same signature), so conformance passes;
    // only the verifier-key comparison against the deployed state catches it.
    const sim = await registry(w, bundled(w, { [w.std.address]: 'standard_token', [w.aud.address]: 'standard_token' }));
    expect(await failureKind(() => sim.call('pay', 2n, ALICE, BOB, 1n))).toBe('ImplementationMismatch');
  });

  it('03-G4 NonconformantImplementation: a module without `transfer` (the registry itself)', async () => {
    const sim = await registry(w, bundled(w, { [w.std.address]: 'token_registry' }));
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('NonconformantImplementation');
  });

  it('03-G5 ProviderThrew: resolve() throws', async () => {
    const sim = await registry(w, { resolve: () => { throw new Error('registry offline'); } });
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('ProviderThrew');
  });

  it('03-G5 ModuleLoadRejected: the thunk rejects', async () => {
    const sim = await registry(w, { resolve: () => () => Promise.reject(new Error('fetch failed')) });
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('ModuleLoadRejected');
  });

  it('03-G5 IncompleteModule: the thunk loads something that is not a contract module', async () => {
    const sim = await registry(w, { resolve: () => async () => ({}) as never });
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('IncompleteModule');
  });

  it('03-G5 MalformedVerifierKeyHash: the module records a garbage fingerprint', async () => {
    const sim = await registry(w, {
      resolve: () => async () => ({ ...(await loadModule.standard_token()), expectedVk: { transfer: 'not-a-hash' } }) as never,
    });
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('MalformedVerifierKeyHash');
  });

  it('03-G5 OperationAbsent: nothing deployed under `transfer` at that address', async () => {
    w.std.state.setOperation('transfer', new ContractOperation());
    const sim = await registry(w, bundled(w, { [w.std.address]: 'standard_token' }));
    expect(await failureKind(() => sim.call('pay', 1n, ALICE, BOB, 1n))).toBe('OperationAbsent');
  });

  it('a refused call leaves the registry state untouched', async () => {
    const sim = await registry(w, bundled(w, {}));
    const before = registryLedger(sim.state).payments;
    await outcome(() => sim.call('pay', 1n, ALICE, BOB, 1n));
    expect(registryLedger(sim.state).payments).toBe(before);
  });
});

describe('03-G6: resolvers beyond a static table', () => {
  it('discoverByVerifierKey binds each listed address to the module whose keys are deployed there', async () => {
    const w = await world();
    const { provider, bindings } = await discoverByVerifierKey([w.std.address, w.aud.address], async (a) => w.chain.get(a));
    expect(bindings).toEqual({ [w.std.address]: 'standard_token', [w.aud.address]: 'audited_token' });
    const sim = await registry(w, provider);
    await sim.call('pay', 2n, ALICE, BOB, 5n);
    expect(Audited.ledger(calleeState(sim, w.aud.address)).audited_transfers).toBe(1n);
  });

  it('discoverByVerifierKey leaves an address running unknown code unbound', async () => {
    const w = await world();
    // Pretend something else is deployed at the audited address.
    const op = new ContractOperation();
    op.verifierKey = verifierKey('token_registry', 'pay');
    w.aud.state.setOperation('transfer', op);
    const { bindings, provider } = await discoverByVerifierKey([w.std.address, w.aud.address], async (a) => w.chain.get(a));
    expect(bindings).toEqual({ [w.std.address]: 'standard_token' });
    const sim = await registry(w, provider);
    expect(await failureKind(() => sim.call('pay', 2n, ALICE, BOB, 1n))).toBe('UnsupportedImplementation');
  });

  it('deferredProvider: an async lookup inside the thunk works, and its failure is ModuleLoadRejected', async () => {
    const w = await world();
    const sim = await registry(w, deferredProvider(async (a) => (a === w.std.address ? 'standard_token' : 'audited_token')));
    expect(await sim.call('pay', 1n, ALICE, BOB, 1n)).toBe(999n);
    const failing = await registry(w, deferredProvider(async () => { throw new Error('lookup service down'); }));
    expect(await failureKind(() => failing.call('pay', 1n, ALICE, BOB, 1n))).toBe('ModuleLoadRejected');
  });
});

describe('03-G10: the generated modules carry the dynamic-resolution tables', () => {
  it('the caller declares the Token interface; each callee publishes transfer\'s signature and key fingerprint', async () => {
    const registryModule = await loadModule.token_registry();
    expect(registryModule.declaredInterfaces).toHaveProperty('Token.transfer');
    for (const impl of ['standard_token', 'audited_token'] as const) {
      const m = await loadModule[impl]();
      expect(m.circuitSignatures).toHaveProperty('transfer');
      expect((m.expectedVk as Record<string, string>)['transfer']).toMatch(/^[0-9a-f]{64}$/);
    }
    // Same signature, different code: the fingerprints must differ.
    const [s, a] = [await loadModule.standard_token(), await loadModule.audited_token()];
    expect(s.circuitSignatures['transfer']).toEqual(a.circuitSignatures['transfer']);
    expect((s.expectedVk as Record<string, string>)['transfer']).not.toBe((a.expectedVk as Record<string, string>)['transfer']);
  });
});
