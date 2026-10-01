// The compiled token and registry modules, and the paths the providers need.
//
// A cross-contract call needs the callee's MODULE (its JS circuits plus the
// tables `expectedVk`, `circuitSignatures`, `declaredInterfaces`) supplied by
// the DApp at run time, keyed by the callee's address. These thunks are what a
// ContractModuleProvider hands back.
import path from 'node:path';
import { readFileSync } from 'node:fs';

export const MANAGED = path.resolve(import.meta.dirname, '..', 'contract', 'managed');
export const managedDir = (name: Implementation | 'token_registry') => path.join(MANAGED, name);

export type Implementation = 'standard_token' | 'audited_token';

export const loadModule = {
  standard_token: () => import('../contract/managed/standard_token/contract/index.js'),
  audited_token: () => import('../contract/managed/audited_token/contract/index.js'),
  token_registry: () => import('../contract/managed/token_registry/contract/index.js'),
} as const;

/** The raw verifier key the compiler wrote for one circuit. */
export const verifierKey = (name: Implementation | 'token_registry', circuit: string): Uint8Array =>
  readFileSync(path.join(managedDir(name), 'keys', `${circuit}.verifier`));

/** A contract reference argument: the TS shape of a value of contract type. */
export const ref = (address: string) => ({ bytes: Uint8Array.from(Buffer.from(address, 'hex')) });
