import { describe, expect, it } from 'vitest';
import { assertNotInPublicState, collectPublicBytes, expectRejects, findInPublicState } from './index.js';

const bytes = (fill: number, n = 32): Uint8Array => new Uint8Array(n).fill(fill);

// Shaped like a compiler-generated ledger(): getters for Cell fields, and a
// Map ADT as an object with methods and a [key, value] iterator.
function fixtureLedger(potCoinNonce: Uint8Array) {
  const entries: [Uint8Array, { nonce: Uint8Array; color: Uint8Array; value: bigint }][] = [
    [bytes(0x10), { nonce: potCoinNonce, color: bytes(0x20), value: 5n }],
  ];
  return {
    get owner() {
      return bytes(0x01);
    },
    get round() {
      return 3n;
    },
    pot: {
      isEmpty: () => entries.length === 0,
      size: () => BigInt(entries.length),
      member: (k: Uint8Array) => entries.some(([key]) => key === k),
      lookup: (k: Uint8Array) => entries.find(([key]) => key === k)?.[1],
      [Symbol.iterator]: () => entries[Symbol.iterator](),
    },
    seen: {
      isEmpty: () => false,
      member: () => true,
      [Symbol.iterator]: () => [bytes(0x30)][Symbol.iterator](),
    },
  };
}

describe('collectPublicBytes', () => {
  it('walks cells, struct fields, Map keys and values, and Set elements', () => {
    const labels = collectPublicBytes(fixtureLedger(bytes(0x40))).map((b) => b.label);
    expect(labels).toEqual(['owner', 'pot[0].key', 'pot[0].value.nonce', 'pot[0].value.color', 'seen[0]']);
  });
});

describe('assertNotInPublicState', () => {
  it('passes when no secret is in public state', () => {
    expect(() => assertNotInPublicState(fixtureLedger(bytes(0x40)), { tipperKey: bytes(0x99) })).not.toThrow();
  });

  // Negative control: a secret planted in a ledger field must be caught, and
  // the message must name the secret and the field.
  it('fails on a planted secret and names the field', () => {
    const secret = bytes(0x77);
    const ledger = fixtureLedger(secret);
    expect(findInPublicState(ledger, secret)).toBe('pot[0].value.nonce');
    expect(() => assertNotInPublicState(ledger, { tipperNonce: secret })).toThrow(
      'tipperNonce found in public state at pot[0].value.nonce',
    );
  });

  it('catches a secret embedded inside a larger byte string', () => {
    const secret = bytes(0x55, 8);
    const field = new Uint8Array(32);
    field.set(secret, 12);
    expect(findInPublicState({ blob: field }, secret)).toBe('blob');
  });
});

describe('expectRejects', () => {
  it('returns the error when the message matches', () => {
    const err = expectRejects(() => {
      throw new Error('failed assert: not the owner');
    }, 'not the owner');
    expect(err.message).toContain('not the owner');
  });

  it('fails when the call succeeds', () => {
    expect(() => expectRejects(() => 1, 'nope')).toThrow('but the call succeeded');
  });

  it('fails when the message differs', () => {
    expect(() =>
      expectRejects(() => {
        throw new Error('other');
      }, 'not the owner'),
    ).toThrow('got: other');
  });
});
