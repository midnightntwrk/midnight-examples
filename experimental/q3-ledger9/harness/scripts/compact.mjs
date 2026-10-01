// Shared compile helper. Every Q3 contract is compiled with compactc 0.35.0,
// the record's pinned toolchain, without touching the machine's default
// compiler (mn-examples' ledger 8 examples still need 0.31.1):
//   compact update --no-set-default 0.35.0
//
// Set Q3_SKIP_ZK=1 to pass --skip-zk (no proving keys): enough for the
// in-memory `sim` tests, not for the local-network `e2e` ones.
import { spawnSync } from 'node:child_process';

export const COMPILER = process.env['Q3_COMPILER'] ?? '0.35.0';

/** Compiles one source; `flags` are extra compactc flags (e.g. --feature-zkir-v3). */
export function compile(source, outDir, flags = []) {
  const args = ['compile', `+${COMPILER}`, ...flags];
  if (process.env['Q3_SKIP_ZK'] === '1') args.push('--skip-zk');
  args.push(source, outDir);
  console.log(`$ compact ${args.join(' ')}`);
  const r = spawnSync('compact', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
