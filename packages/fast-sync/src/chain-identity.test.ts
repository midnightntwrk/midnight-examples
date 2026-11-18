import { checkChainStamp, readChainStamp, type ChainStamp } from './chain-identity.js';

const INDEXER = 'https://indexer.example.test/api/v4/graphql?project_id=secret';
const HASH = 'ab'.repeat(32);
const STAMP: ChainStamp = { indexer: 'indexer.example.test', height: 500, blockHash: HASH };

/** A fetch that answers every GraphQL query with `data`, recording the queries. */
function indexer(data: unknown, queries: string[] = []): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    queries.push((JSON.parse(String(init?.body)) as { query: string }).query);
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

const unreachable = (async () => {
  throw new Error('ECONNREFUSED');
}) as typeof fetch;

describe('readChainStamp', () => {
  it('stamps the tip with the indexer host only', async () => {
    const stamp = await readChainStamp(INDEXER, indexer({ block: { height: 500, hash: HASH } }));
    expect(stamp).toEqual(STAMP);
    expect(JSON.stringify(stamp)).not.toContain('secret');
  });

  it('gives undefined when the indexer is unreachable or has no tip', async () => {
    expect(await readChainStamp(INDEXER, unreachable)).toBeUndefined();
    expect(await readChainStamp(INDEXER, indexer({ block: null }))).toBeUndefined();
  });
});

describe('checkChainStamp', () => {
  it('passes when the block at the stamped height has the stamped hash', async () => {
    const queries: string[] = [];
    expect(await checkChainStamp(INDEXER, STAMP, indexer({ block: { hash: HASH } }, queries))).toBeNull();
    expect(queries[0]).toContain('height: 500');
  });

  it('fails when the hash differs (a reset chain that grew past the height)', async () => {
    expect(await checkChainStamp(INDEXER, STAMP, indexer({ block: { hash: 'cd'.repeat(32) } }))).toMatch(
      /block 500 is cd.*reset/,
    );
  });

  it('fails when the chain has no block at that height (a reset chain still short of it)', async () => {
    expect(await checkChainStamp(INDEXER, STAMP, indexer({ block: null }))).toMatch(/no block 500/);
  });

  it('fails when the indexer is unreachable', async () => {
    expect(await checkChainStamp(INDEXER, STAMP, unreachable)).toMatch(/can't be reached/);
  });

  it('fails for state synced against another indexer, without asking the chain', async () => {
    const queries: string[] = [];
    const other = 'https://midnight-preprod.blockfrost.io/api/v0?project_id=x';
    expect(await checkChainStamp(other, STAMP, indexer({ block: { hash: HASH } }, queries))).toMatch(
      /indexer\.example\.test, not midnight-preprod\.blockfrost\.io/,
    );
    expect(queries).toHaveLength(0);
  });
});
