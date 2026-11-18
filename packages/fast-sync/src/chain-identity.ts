// Which chain, and which indexer, a saved wallet state belongs to.
//
// A network can be reset to a new chain that keeps the old genesis hash
// (Preview, 6 November 2026), so genesis can't tell two chains apart. A block
// further along can: the saved state records the indexer's tip height and the
// hash there, and a restore checks the block at that height still has that
// hash. The state also records the indexer's host, because the wallet resumes
// by event id and indexers number events differently (Blockfrost's preprod ids
// run 22 behind the official indexer's), so cursors don't transfer.

/** Where a saved wallet state was synced: the indexer's host and a block on its chain. */
export interface ChainStamp {
  /** The indexer's host only, so a token in its URL (Blockfrost's project_id) is never written down. */
  indexer: string;
  height: number;
  blockHash: string;
}

async function query<T>(indexerHttpUrl: string, body: string, fetchImpl: typeof fetch): Promise<T | undefined> {
  try {
    const res = await fetchImpl(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return undefined;
    return ((await res.json()) as { data?: T }).data;
  } catch {
    return undefined;
  }
}

/** The hash of the block at `height`, or undefined if the indexer has none or can't be reached. */
export async function getBlockHash(
  indexerHttpUrl: string,
  height: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const data = await query<{ block?: { hash?: string } | null }>(
    indexerHttpUrl,
    `query { block(offset: { height: ${Math.trunc(height)} }) { hash } }`,
    fetchImpl,
  );
  const hash = data?.block?.hash;
  return typeof hash === 'string' ? hash : undefined;
}

/** A stamp for the indexer's current tip, or undefined if it can't be read. */
export async function readChainStamp(
  indexerHttpUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChainStamp | undefined> {
  const data = await query<{ block?: { height?: number; hash?: string } | null }>(
    indexerHttpUrl,
    'query { block { height hash } }',
    fetchImpl,
  );
  const height = data?.block?.height;
  const blockHash = data?.block?.hash;
  if (typeof height !== 'number' || height <= 0 || typeof blockHash !== 'string') return undefined;
  return { indexer: new URL(indexerHttpUrl).host, height, blockHash };
}

/**
 * Whether `stamp` belongs to the indexer at `indexerHttpUrl` and to the chain
 * it serves now. Returns null when it does, else why not. A network reset is
 * the case this catches: the saved cursors would point into a chain that no
 * longer exists.
 */
export async function checkChainStamp(
  indexerHttpUrl: string,
  stamp: ChainStamp,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const host = new URL(indexerHttpUrl).host;
  if (stamp.indexer !== host) return `it was synced against ${stamp.indexer}, not ${host}`;
  const hash = await getBlockHash(indexerHttpUrl, stamp.height, fetchImpl);
  if (hash === undefined) return `the indexer has no block ${stamp.height} or can't be reached (was the network reset?)`;
  if (hash !== stamp.blockHash) return `block ${stamp.height} is ${hash}, not ${stamp.blockHash} (was the network reset?)`;
  return null;
}
