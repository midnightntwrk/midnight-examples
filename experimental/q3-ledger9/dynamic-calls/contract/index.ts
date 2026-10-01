// The three deployable contracts, wrapped for Midnight.js. None has witnesses:
// a callee entered by a cross-contract call may not use them.
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as Standard from './managed/standard_token/contract/index.js';
import * as Audited from './managed/audited_token/contract/index.js';
import * as Registry from './managed/token_registry/contract/index.js';
import { managedDir } from '../src/modules.js';

export const CompiledStandardToken = CompiledContract.make('StandardToken', Standard.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(managedDir('standard_token')),
);
export const CompiledAuditedToken = CompiledContract.make('AuditedToken', Audited.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(managedDir('audited_token')),
);
export const CompiledTokenRegistry = CompiledContract.make('TokenRegistry', Registry.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(managedDir('token_registry')),
);

export const standardLedger = Standard.ledger;
export const auditedLedger = Audited.ledger;
export const registryLedger = Registry.ledger;
