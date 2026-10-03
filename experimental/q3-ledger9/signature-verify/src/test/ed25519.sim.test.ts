// SOW-Q3-01 AC-1 at L1: ed25519Verify<n> run in memory through pure circuits.
// Gap ids refer to the Foundation's SOW3 testing strategy (internal).
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { outcome } from '@q3/harness/sim';
import { pureCircuits as ed } from '../../contract/managed/ed25519_vectors/contract/index.js';
import { edPoint, edSignature } from '../encode.js';
import { cardanoPayment, long1023, otherCardanoTxId, rfcTest1, rfcTest2, rfcTestShaAbc, type EdVector } from '../fixtures/ed25519.js';

const flip = (m: Uint8Array, i = m.length - 1) => Uint8Array.from(m, (b, j) => (j === i ? b ^ 0x01 : b));
const args = (v: EdVector, msg = v.message) => [msg, edSignature(v.signature), edPoint(v.publicKey)] as const;

describe('AC-1 ed25519Verify: accepts genuine signatures, refuses altered ones', () => {
  it('n = 0, RFC 8032 TEST 1 (01-G7)', () => {
    expect(ed.verify_empty(...args(rfcTest1))).toBe(true);
  });

  it('n = 1, RFC 8032 TEST 2, and the same signature over another byte', () => {
    expect(ed.verify_1(...args(rfcTest2))).toBe(true);
    expect(ed.verify_1(...args(rfcTest2, Uint8Array.of(0x73)))).toBe(false);
  });

  it('n = 32, Cardano mainnet vkey witness, and the same signature for another tx', () => {
    expect(ed.verify_32(...args(cardanoPayment))).toBe(true);
    expect(ed.verify_32(...args(cardanoPayment, otherCardanoTxId))).toBe(false);
  });

  it('n = 64, RFC 8032 SHA(abc), and with the last bit flipped', () => {
    expect(ed.verify_64(...args(rfcTestShaAbc))).toBe(true);
    expect(ed.verify_64(...args(rfcTestShaAbc, flip(rfcTestShaAbc.message)))).toBe(false);
  });

  it('n = 1023, sha512 over many blocks in-circuit (01-G7)', () => {
    expect(ed.verify_1023(...args(long1023))).toBe(true);
    expect(ed.verify_1023(...args(long1023, flip(long1023.message, 0)))).toBe(false);
  });

  it('wrong key: TEST 2 signature against the TEST 1 key', () => {
    expect(ed.verify_1(rfcTest2.message, edSignature(rfcTest2.signature), edPoint(rfcTest1.publicKey))).toBe(false);
  });
});

describe('AC-1 ed25519Verify: hostile inputs are refused, never accepted', () => {
  const [msg, sig] = args(rfcTest2);

  it('identity key (0, 1) is refused by assertion (toolchain notes: "asserts the key is not the identity")', async () => {
    const o = await outcome(() => ed.verify_1(msg, sig, { x: 0n, y: 1n }));
    expect(o).toMatchObject({ kind: 'rejected' });
    expect(o.kind === 'rejected' && o.message).toMatch(/identity/i);
  });

  it('off-curve key is a type error before the circuit runs', async () => {
    const o = await outcome(() => ed.verify_1(msg, sig, { x: 1n, y: 1n }));
    expect(o).toMatchObject({ kind: 'rejected' });
  });

  it('small-order key (order 2: (0, -1)) is refused by the subgroup check', async () => {
    const p = ed25519.Point.CURVE().p;
    const o = await outcome(() => ed.verify_1(msg, sig, { x: 0n, y: p - 1n }));
    expect(o).toMatchObject({ kind: 'rejected' });
  });

  it('non-canonical s (s + L) is refused, not accepted as the same signature', async () => {
    const L = ed25519.Point.CURVE().n;
    const o = await outcome(() => ed.verify_1(msg, { ...sig, s: sig.s + L }, edPoint(rfcTest2.publicKey)));
    expect(o).not.toEqual({ kind: 'value', value: true });
    expect(o.kind).toBe('rejected');
  });
});
