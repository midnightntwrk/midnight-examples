// Three ways a DApp can answer "which code implements the contract at this
// address?" (CoIP 4: "ranging from a fixed, statically-known mapping to a
// fully dynamic, online lookup system").
//
// The runtime contract is `resolve(address): ModuleThunk | undefined`, and
// `resolve` must be SYNCHRONOUS and total (toolchain-0.35.0 notes). Anything
// slow (network, disk) belongs either before the call (pre-resolve into a
// table) or inside the thunk.
import { verifierKeyHashOf, type ContractModuleProvider, type ContractState } from '@midnight-ntwrk/compact-runtime';
import { bundledContractModuleProvider } from '@midnight-ntwrk/midnight-js-bundled-contract-module-provider';
import { loadModule, type Implementation } from './modules.js';

/** (a) Static: the DApp ships a fixed address -> module table. */
export function staticProvider(bindings: Record<string, Implementation>): ContractModuleProvider {
  return bundledContractModuleProvider(
    new Map(Object.entries(bindings).map(([address, impl]) => [address, loadModule[impl]])),
  );
}

/**
 * (b) Discovered: the DApp knows a set of CANDIDATE implementations and looks
 * up, per address, which one is deployed there by matching the verifier key
 * on chain against each candidate's `expectedVk`. New listings resolve without
 * shipping a new table, and an address running unknown code stays unbound
 * (the call then fails with UnsupportedImplementation instead of running the
 * wrong module).
 *
 * `fetchState` is the online part: the indexer in e2e, a map in memory.
 */
export async function discoverByVerifierKey(
  addresses: string[],
  fetchState: (address: string) => Promise<ContractState | null | undefined>,
  candidates: Implementation[] = ['standard_token', 'audited_token'],
  circuit = 'transfer',
): Promise<{ provider: ContractModuleProvider; bindings: Record<string, Implementation> }> {
  const fingerprints = await Promise.all(
    candidates.map(async (impl) => [impl, ((await loadModule[impl]()).expectedVk as Record<string, string>)[circuit]] as const),
  );
  const bindings: Record<string, Implementation> = {};
  for (const address of addresses) {
    const key = (await fetchState(address))?.operation(circuit)?.verifierKey;
    if (!key || key.length === 0) continue;
    const onChain = verifierKeyHashOf(key);
    const match = fingerprints.find(([, fp]) => fp === onChain);
    if (match) bindings[address] = match[0];
  }
  return { provider: staticProvider(bindings), bindings };
}

/**
 * (c) Deferred: resolve() always answers with a thunk and the lookup happens
 * when the runtime loads the module. A lookup failure surfaces as
 * ModuleLoadRejected rather than UnsupportedImplementation.
 */
export function deferredProvider(lookup: (address: string) => Promise<Implementation>): ContractModuleProvider {
  return { resolve: (address) => async () => loadModule[await lookup(String(address))]() as never };
}
