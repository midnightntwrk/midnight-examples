// The deployable contract of this example, wrapped for Midnight.js.
import path from 'node:path';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from './managed/signature_auth/contract/index.js';
import { witnesses } from '../src/witnesses.js';
export { ledger } from './managed/signature_auth/contract/index.js';

export const signatureAuthManagedDir = path.resolve(import.meta.dirname, 'managed', 'signature_auth');

export const CompiledSignatureAuth = CompiledContract.make('SignatureAuth', Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(signatureAuthManagedDir),
);
