// Load a pre-built pre-seed reference bundle shipped with this repo.
//
// A reference is an empty throwaway wallet synced to chain tip once, then
// serialized. New wallets restore from it (with their own keys swapped in)
// instead of walking the chain from genesis — turning a ~78-minute preprod
// first sync into seconds. See FAST-SYNC.md at the repo root.
//
// The bundle format matches what moth-wallet's `scripts/export-preseed.mjs`
// writes: one gzipped serialized state per sub-wallet plus a manifest recording
// the chain height, the block hash there, the indexer the cursors came from and
// a witness per cursor-bearing part. A bundle that fails any check is not used.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** A reference's three serialized sub-wallet states plus the height it holds. */
export interface EmptyRefStates {
  shielded: string;
  unshielded: string;
  dust: string;
  /**
   * Chain height this reference was synced to. A wallet may only be seeded from
   * it when the wallet's birthday is at or after this height — otherwise the
   * reference starts the wallet past its own history and hides earlier funds.
   * This is a block height; a snapshot's `offset` is an event index — never
   * compare the two.
   */
  height: number;
  /** The hash of the block at `height` on the chain the bundle was cut from. */
  blockHash: string;
}

interface BundleManifest {
  network: string;
  height: number;
  /** Host of the indexer the cursors came from (event ids are per indexer). */
  indexer?: string;
  blockHash?: string;
  parts: Record<string, { bytes: number; gzipBytes: number }>;
  witnesses?: Record<string, { stream: string; id: number; digest: string }>;
}

const PARTS = ['shielded', 'unshielded', 'dust'] as const;
/** The parts with a ledger-event cursor, so a witness in the manifest. */
const WITNESSED = ['shielded', 'dust'] as const;

/**
 * The applied-index a serialized snapshot resumes from. `offset === 0` is the
 * SDK's "stream from genesis" sentinel, so a reference whose dust or shielded
 * offset is 0 seeds nothing however complete the rest looks.
 */
function snapshotOffset(raw: string): bigint {
  try {
    const parsed = JSON.parse(raw) as { offset?: string | number };
    return parsed.offset === undefined ? 0n : BigInt(parsed.offset);
  } catch {
    return 0n;
  }
}

/** A part's witness digest, as cut-preseed writes it. */
export const stateDigest = (raw: string): string => createHash('sha256').update(raw).digest('hex').slice(0, 16);

export type ReferenceBundleResult = { ok: true; bundle: EmptyRefStates } | { ok: false; reason: string };

/**
 * Read the reference for `networkId` from `<referenceRoot>/<networkId>/`, cut
 * against the indexer at `indexer` (a URL; only its host is compared).
 *
 * Fails, with the reason, for: no bundle for this network, a corrupt file, a
 * network or indexer mismatch, a missing height or block hash, a part that
 * doesn't match its manifest witness, or a genesis-offset cursor. The chain
 * itself isn't consulted here; see checkChainIdentity.
 */
export function readReferenceBundle(
  referenceRoot: string,
  networkId: string,
  { indexer }: { indexer: string },
): ReferenceBundleResult {
  const fail = (reason: string): ReferenceBundleResult => ({ ok: false, reason });
  const dir = join(referenceRoot, networkId);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return fail(`no reference bundle for '${networkId}' in ${referenceRoot}`);

  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest;
  } catch {
    return fail(`${manifestPath} is not valid JSON`);
  }
  if (manifest.network !== networkId) return fail(`the bundle is for '${manifest.network}', not '${networkId}'`);
  if (!Number.isFinite(manifest.height) || manifest.height <= 0) return fail('the manifest has no height');
  if (typeof manifest.blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.blockHash)) {
    return fail('the manifest has no blockHash (re-cut the bundle, or stamp it with `preseed:cut -- --stamp`)');
  }
  const host = new URL(indexer).host;
  if (manifest.indexer !== host) {
    // Ledger-event ids are the indexer's own numbering: Blockfrost's preprod
    // ids run 22 behind the official indexer's, so cursors don't transfer.
    return fail(`the bundle was cut against ${manifest.indexer ?? 'an unrecorded indexer'}, not ${host}`);
  }

  const states: Partial<Record<(typeof PARTS)[number], string>> = {};
  for (const part of PARTS) {
    const file = join(dir, `${part}.dat.gz`);
    if (!existsSync(file)) return fail(`${part}.dat.gz is missing`);
    try {
      states[part] = gunzipSync(readFileSync(file)).toString('utf8');
    } catch {
      return fail(`${part}.dat.gz does not decompress`);
    }
  }

  const shielded = states.shielded;
  const unshielded = states.unshielded;
  const dust = states.dust;
  if (!shielded || !unshielded || !dust) return fail('a part is empty');

  // A reference whose dust/shielded cursor is 0 would seed a genesis stream.
  if (snapshotOffset(dust) <= 0n || snapshotOffset(shielded) <= 0n) return fail('a cursor is at genesis');

  for (const part of WITNESSED) {
    const witness = manifest.witnesses?.[part];
    const raw = part === 'dust' ? dust : shielded;
    if (!witness) return fail(`the manifest has no ${part} witness`);
    if (BigInt(witness.id) !== snapshotOffset(raw)) return fail(`${part} cursor doesn't match its witness id`);
    if (witness.digest !== stateDigest(raw)) return fail(`${part}.dat.gz doesn't match its witness digest`);
  }

  return { ok: true, bundle: { shielded, unshielded, dust, height: manifest.height, blockHash: manifest.blockHash } };
}

/**
 * readReferenceBundle, as the bundle or null. Failing closed means a packaging
 * problem costs a slow sync, never a wallet seeded from half a reference.
 */
export function loadReferenceBundle(
  referenceRoot: string,
  networkId: string,
  opts: { indexer: string },
): EmptyRefStates | null {
  const r = readReferenceBundle(referenceRoot, networkId, opts);
  return r.ok ? r.bundle : null;
}

/** The hash of the block at `height`, or undefined if the indexer has none or can't be reached. */
export async function getBlockHash(
  indexerHttpUrl: string,
  height: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `query { block(offset: { height: ${Math.trunc(height)} }) { hash } }` }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: { block?: { hash?: string } | null } };
    const hash = json.data?.block?.hash;
    return typeof hash === 'string' ? hash : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the chain behind `indexerHttpUrl` is the one the bundle was cut
 * from: the block at the bundle's height has its recorded hash. Returns null
 * when it is, else why not. A network reset is the case this catches: the
 * bundle's cursors would point into a chain that no longer exists.
 */
export async function checkChainIdentity(
  indexerHttpUrl: string,
  bundle: Pick<EmptyRefStates, 'height' | 'blockHash'>,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const hash = await getBlockHash(indexerHttpUrl, bundle.height, fetchImpl);
  if (hash === undefined) return `couldn't read block ${bundle.height} from the indexer`;
  if (hash !== bundle.blockHash) return `block ${bundle.height} is ${hash}, not the bundle's ${bundle.blockHash} (was the network reset?)`;
  return null;
}
