import path from 'node:path';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from './managed/counter/contract/index.js';
export { ledger } from './managed/counter/contract/index.js';

export const counterManagedDir = path.resolve(import.meta.dirname, 'managed', 'counter');

export const CompiledCounter = CompiledContract.make('Counter', Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(counterManagedDir),
);
