import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findReferenceRoot } from './resolve.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnkit-preseed-'));
  delete process.env.MIDNIGHT_PRESEED_DIR;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MIDNIGHT_PRESEED_DIR;
});

/** `<dir>/preseed/<net>/manifest.json`, returning the preseed dir. */
function bundleAt(dir: string, net = 'preview'): string {
  mkdirSync(join(dir, 'preseed', net), { recursive: true });
  writeFileSync(join(dir, 'preseed', net, 'manifest.json'), '{}');
  return join(dir, 'preseed');
}

const project = (...parts: string[]) => {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('findReferenceRoot', () => {
  it('finds the nearest preseed/ with this network', () => {
    mkdirSync(join(root, '.git'));
    const want = bundleAt(root);
    expect(findReferenceRoot('preview', project('examples', 'hello-world'))).toBe(want);
  });

  it('skips a file named preseed', () => {
    mkdirSync(join(root, '.git'));
    const inner = project('app');
    writeFileSync(join(inner, 'preseed'), 'not a bundle');
    const want = bundleAt(root);
    expect(findReferenceRoot('preview', inner)).toBe(want);
  });

  it("walks past a preseed/ without this network's bundle", () => {
    mkdirSync(join(root, '.git'));
    const want = bundleAt(root, 'preview');
    const inner = project('app');
    bundleAt(inner, 'preprod');
    expect(findReferenceRoot('preview', inner)).toBe(want);
    expect(findReferenceRoot('preprod', inner)).toBe(join(inner, 'preseed'));
  });

  it('stops at the repo root (.git)', () => {
    bundleAt(root);
    const repo = project('repo');
    mkdirSync(join(repo, '.git'));
    expect(findReferenceRoot('preview', project('repo', 'app'))).toBeNull();
  });

  it.skipIf(typeof process.getuid !== 'function')('skips a preseed/ others can write to', () => {
    mkdirSync(join(root, '.git'));
    const want = bundleAt(root);
    const shared = project('shared');
    const planted = bundleAt(shared);
    chmodSync(planted, 0o777);
    expect(findReferenceRoot('preview', shared)).toBe(want);
    chmodSync(planted, 0o755);
    chmodSync(shared, 0o1777); // like /tmp
    expect(findReferenceRoot('preview', shared)).toBe(want);
    chmodSync(shared, 0o755);
  });

  it('MIDNIGHT_PRESEED_DIR wins', () => {
    mkdirSync(join(root, '.git'));
    bundleAt(root);
    process.env.MIDNIGHT_PRESEED_DIR = join(root, 'elsewhere');
    expect(findReferenceRoot('preview', root)).toBe(join(root, 'elsewhere'));
  });
});
