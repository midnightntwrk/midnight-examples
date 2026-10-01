// What stack a run actually used. Every acceptance report embeds this, because
// "passed" only means something next to the versions it passed on
// (q3-testing-strategy.md, P5 version-drift log).
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const WORKSPACE = path.resolve(import.meta.dirname, '..', '..');

// The record's Component versions table (2026-q3-deliverables.md), except
// Midnight.js, which is rc.2 because SOW-Q3-03's module provider first ships
// there, and onchain-runtime, pinned to rc.4 to match the record (vendor QA
// ran rc.3).
export const EXPECTED: Record<string, string> = {
  '@midnightntwrk/ledger-v9': '1.0.0-rc.5',
  '@midnightntwrk/onchain-runtime-v4': '4.0.0-rc.4',
  '@midnight-ntwrk/compact-runtime': '0.20.0',
  '@midnight-ntwrk/compact-js': '3.0.0-rc.3',
  '@midnight-ntwrk/platform-js': '3.0.0',
  '@midnight-ntwrk/midnight-js-contracts': '5.0.0-rc.2',
  '@midnight-ntwrk/midnight-js-bundled-contract-module-provider': '5.0.0-rc.2',
  '@midnight-ntwrk/testkit-js': '5.0.0-rc.2',
  '@midnightntwrk/wallet-sdk-facade': '5.0.0-rc.0',
};

export const IMAGES = [
  'midnightntwrk/midnight-node:2.1.0-rc.3',
  'ghcr.io/midnightntwrk/indexer-standalone:4.4.0-rc.6-068403cd',
  'midnightntwrk/proof-server:9.0.0-rc.8',
];

export interface StackEntry { name: string; expected: string; resolved: string; local: boolean }

// Some packages do not export ./package.json, so resolve the entry point and
// walk up to the manifest that names the package.
function manifestOf(name: string): string {
  // ESM resolution: several of these packages are ESM-only.
  let dir = path.dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    try {
      if (JSON.parse(readFileSync(candidate, 'utf8')).name === name) return candidate;
    } catch {
      // no manifest here; keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no package.json found for ${name}`);
    dir = parent;
  }
}

export function packages(): StackEntry[] {
  return Object.entries(EXPECTED).map(([name, expected]) => {
    const pkgJson = manifestOf(name);
    const resolved = JSON.parse(readFileSync(pkgJson, 'utf8')).version as string;
    // A package resolved from mn-examples' root node_modules would be the
    // ledger 8 stack leaking in through Node's parent-directory lookup.
    return { name, expected, resolved, local: pkgJson.startsWith(path.join(WORKSPACE, 'node_modules')) };
  });
}

export function compiler(): string {
  return execFileSync('compact', ['compile', '+0.35.0', '--version'], { encoding: 'utf8' }).trim();
}

export function imageDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const image of IMAGES) {
    try {
      out[image] = execFileSync('docker', ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      out[image] = 'not pulled';
    }
  }
  return out;
}
