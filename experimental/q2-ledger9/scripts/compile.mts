// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Compile every dapp's Compact contracts into contracts/<dapp>/managed/<Name>.
//
// Cross-contract dapps declare callee interfaces inline (`contract X { ... }`)
// and the compiler resolves them against sibling managed/<X> artifacts, so each
// dapp compiles into its OWN managed root (DEX / FungibleToken names repeat
// across dapps) and contracts compile in dependency order.
//
// Compiler: Compact toolchain 0.36.0 via the Compact CLI (`compact compile +0.36.0`;
// install it with `compact update 0.36.0`). Set COMPACTC=/path/to/compactc to use a
// specific compactc binary instead. Some contracts need per-contract flags.
// We compile every dapp regardless and report a summary; the vitest suites skip
// with a GAP banner when their artifact is missing.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = path.join(REPO, 'contracts');
const EXPECTED_VERSION = '0.36.0';
const COMPACTC = process.env.COMPACTC;
// [command, ...leading args]: either the given compactc binary or the Compact CLI.
const COMPILER: string[] = COMPACTC ? [COMPACTC] : ['compact', 'compile', `+${EXPECTED_VERSION}`];

type Contract = { source: string; managed: string; flags?: string[] };
type Dapp = { dir: string; contracts: Contract[] };

// Order within each dapp mirrors compact-end-2-end/infra/e2e.ts DAPPS.
const DAPPS: Dapp[] = [
  { dir: 'fungible-token', contracts: [{ source: 'FungibleToken', managed: 'FungibleToken' }] },
  { dir: 'events', contracts: [{ source: 'Events', managed: 'Events' }] },
  {
    dir: 'no-witness-dex',
    contracts: [
      { source: 'FungibleToken', managed: 'FungibleToken' },
      { source: 'DEX', managed: 'DEX' },
    ],
  },
  {
    dir: 'uniswap',
    contracts: [
      { source: 'USDC', managed: 'USDC' },
      { source: 'DEX', managed: 'DEX' },
      { source: 'MyToken', managed: 'MyToken' },
    ],
  },
  {
    dir: 'usdcx',
    // Verifies ECDSA against supplied pubkeys (no recover-path primitives).
    contracts: [
      { source: 'bridged-usdc-mint', managed: 'BridgedUsdcMint' },
    ],
  },
  { dir: 'self-recursion', contracts: [{ source: 'SelfRecursion', managed: 'SelfRecursion' }] },
  {
    dir: 'caller',
    contracts: [
      { source: 'Caller', managed: 'Caller' },
      { source: 'Proxy', managed: 'Proxy' },
    ],
  },
  { dir: 'axelar-gateway', contracts: [{ source: 'AxelarGateway', managed: 'AxelarGateway' }] },
  {
    // Provable secp256k1 → Ethereum address.
    dir: 'eth-addr-secp',
    contracts: [
      { source: 'prove-eth-addr-secp', managed: 'ProveEthAddrSecp' },
    ],
  },
  {
    // Instantiate secp256k1EcdsaVerify twice/thrice in a single circuit over one
    // digest with independent (sig, pubkey) witness pairs.
    dir: 'verify-sequential-secp',
    contracts: [
      {
        source: 'verify-sequential-secp',
        managed: 'VerifySequentialSecp',
      },
    ],
  },
  {
    // ECDSA public-key recovery. The recover API is absent on 0.36.0, so this is a
    // compile-gap regression guard that compiles once the API is restored.
    dir: 'recover-secp',
    contracts: [
      { source: 'recover-secp', managed: 'RecoverSecp' },
    ],
  },
];

if (COMPACTC && !fs.existsSync(COMPACTC)) {
  console.error(`COMPACTC is set but ${COMPACTC} does not exist.`);
  process.exit(1);
}

const probe = spawnSync(COMPILER[0], [...COMPILER.slice(1), '--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error(
    `could not run ${COMPILER.join(' ')} --version.\n` +
      `Install the Compact CLI and run \`compact update ${EXPECTED_VERSION}\`, or set COMPACTC.`,
  );
  process.exit(1);
}
const version = probe.stdout?.trim();
console.log(`compiler: ${COMPILER.join(' ')} (${version})\n`);
if (!version?.includes(EXPECTED_VERSION)) {
  console.warn(`WARNING: expected Compact ${EXPECTED_VERSION}; the results below are for that version.\n`);
}

const failed: string[] = [];
const compiled: string[] = [];

for (const dapp of DAPPS) {
  const dappDir = path.join(CONTRACTS, dapp.dir);
  const managedRoot = path.join(dappDir, 'managed');
  for (const c of dapp.contracts) {
    const source = path.join(dappDir, `${c.source}.compact`);
    const out = path.join(managedRoot, c.managed);
    const label = `${dapp.dir}/${c.source}`;
    fs.rmSync(out, { recursive: true, force: true });
    process.stdout.write(`  compiling ${label} ... `);
    const res = spawnSync(COMPILER[0], [...COMPILER.slice(1), ...(c.flags ?? []), source, out], {
      encoding: 'utf8',
    });
    if (res.status === 0) {
      console.log('ok');
      compiled.push(label);
    } else {
      console.log('FAILED');
      if (res.stderr) {
        const firstLines = res.stderr.trim().split('\n').slice(0, 4).join('\n');
        console.log(firstLines.replace(/^/gm, '      '));
      }
      failed.push(label);
      // Keep going: other dapps are independent, and gaps are expected.
    }
  }
}

console.log(`\ncompiled ${compiled.length}, failed ${failed.length}`);
if (failed.length) {
  console.log(`  gaps:`);
  for (const f of failed) console.log(`    - ${f}`);
}
// Always exit 0: gaps are expected and the suites gate on artifact presence.
process.exit(0);
