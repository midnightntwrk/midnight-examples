import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkChainIdentity, readReferenceBundle, stateDigest } from './reference-bundle.js';

const INDEXER = 'https://indexer.example.test/api/v4/graphql';
const HASH = 'ab'.repeat(32);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnkit-bundle-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write a bundle for `network` as cut-preseed does, then let `edit` change the manifest. */
function writeBundle(edit: (m: Record<string, any>) => void = () => {}, network = 'preview') {
  const dir = join(root, network);
  mkdirSync(dir, { recursive: true });
  const states = {
    shielded: JSON.stringify({ state: 's', offset: '120' }),
    unshielded: JSON.stringify({ state: 'u', appliedId: '7' }),
    dust: JSON.stringify({ state: 'd', offset: '121' }),
  };
  for (const [part, raw] of Object.entries(states)) writeFileSync(join(dir, `${part}.dat.gz`), gzipSync(raw));
  const manifest: Record<string, any> = {
    network,
    height: 500,
    blockHash: HASH,
    indexer: 'indexer.example.test',
    parts: {},
    witnesses: {
      shielded: { stream: 'zswapLedgerEvents', id: 120, digest: stateDigest(states.shielded) },
      dust: { stream: 'dustLedgerEvents', id: 121, digest: stateDigest(states.dust) },
    },
  };
  edit(manifest);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

const read = (indexer = INDEXER) => readReferenceBundle(root, 'preview', { indexer });
const reason = (indexer?: string) => {
  const r = read(indexer);
  return r.ok ? null : r.reason;
};

describe('readReferenceBundle', () => {
  it('loads a bundle that matches its manifest', () => {
    writeBundle();
    const r = read();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle).toMatchObject({ height: 500, blockHash: HASH });
  });

  it('rejects a part that does not match its witness digest', () => {
    const dir = writeBundle();
    writeFileSync(join(dir, 'dust.dat.gz'), gzipSync(JSON.stringify({ state: 'other', offset: '121' })));
    expect(reason()).toMatch(/dust.*witness digest/);
  });

  it('rejects a cursor that does not match its witness id', () => {
    writeBundle((m) => (m.witnesses.shielded.id = 119));
    expect(reason()).toMatch(/shielded cursor.*witness id/);
  });

  it('rejects a manifest without witnesses', () => {
    writeBundle((m) => delete m.witnesses);
    expect(reason()).toMatch(/no shielded witness/);
  });

  it('rejects a bundle cut against another indexer', () => {
    writeBundle();
    expect(reason('https://midnight-preprod.blockfrost.io/api/v0?project_id=x')).toMatch(
      /cut against indexer\.example\.test, not midnight-preprod\.blockfrost\.io/,
    );
  });

  it('rejects a manifest that records no indexer', () => {
    writeBundle((m) => delete m.indexer);
    expect(reason()).toMatch(/unrecorded indexer/);
  });

  it('rejects a manifest without a block hash', () => {
    writeBundle((m) => delete m.blockHash);
    expect(reason()).toMatch(/no blockHash/);
  });

  it('rejects a genesis cursor', () => {
    const dir = writeBundle();
    writeFileSync(join(dir, 'shielded.dat.gz'), gzipSync(JSON.stringify({ state: 's', offset: '0' })));
    expect(reason()).toMatch(/genesis/);
  });

  it("rejects another network's bundle", () => {
    writeBundle((m) => (m.network = 'preprod'));
    expect(reason()).toMatch(/for 'preprod', not 'preview'/);
  });

  it('reports a missing bundle', () => {
    expect(reason()).toMatch(/no reference bundle for 'preview'/);
  });

  it('matches the bundles shipped in the repo', () => {
    // Each shipped bundle must pass every local check against its own indexer.
    const repo = join(import.meta.dirname, '..', '..', '..', 'preseed');
    for (const net of ['preview', 'preprod']) {
      const m = JSON.parse(readFileSync(join(repo, net, 'manifest.json'), 'utf8')) as { indexer: string };
      const r = readReferenceBundle(repo, net, { indexer: `https://${m.indexer}/` });
      expect(r.ok ? 'ok' : r.reason).toBe('ok');
    }
  });
});

describe('checkChainIdentity', () => {
  const fakeFetch = (body: unknown, ok = true) =>
    (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  const bundle = { height: 500, blockHash: HASH };

  it('passes when the block at the height has the recorded hash', async () => {
    expect(await checkChainIdentity(INDEXER, bundle, fakeFetch({ data: { block: { hash: HASH } } }))).toBeNull();
  });

  it('fails when the hash differs (a reset network)', async () => {
    const r = await checkChainIdentity(INDEXER, bundle, fakeFetch({ data: { block: { hash: 'cd'.repeat(32) } } }));
    expect(r).toMatch(/reset/);
  });

  it('fails when the block does not exist', async () => {
    expect(await checkChainIdentity(INDEXER, bundle, fakeFetch({ data: { block: null } }))).toMatch(/couldn't read block 500/);
  });

  it('fails when the indexer is unreachable', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await checkChainIdentity(INDEXER, bundle, down)).toMatch(/couldn't read block 500/);
    expect(await checkChainIdentity(INDEXER, bundle, fakeFetch({}, false))).toMatch(/couldn't read block 500/);
  });
});
