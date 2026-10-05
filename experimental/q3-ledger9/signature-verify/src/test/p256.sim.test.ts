// SOW-Q3-01 AC-2 at L1: secp256r1EcdsaVerify run in memory through pure circuits.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { outcome } from '@q3/harness/sim';
import { pureCircuits as pc } from '../../contract/managed/p256_vectors/contract/index.js';
import { P256_N, limbs, utf8 } from '../encode.js';
import { rfc6979, rfc6979LowS, yubikey } from '../fixtures/p256.js';

const sha = (b: Uint8Array) => Uint8Array.from(createHash('sha256').update(b).digest());
const { message: sample, publicKey: pk, signature: highS } = rfc6979;

describe('AC-2 secp256r1EcdsaVerify: genuine and altered signatures', () => {
  it('RFC 6979 A.2.5 verifies with the digest computed in-circuit', () => {
    expect(pc.verify_message(sample, highS, pk)).toBe(true);
  });

  it('s + 1 is not a valid signature (vendor QA negative, repeated on our stack)', () => {
    expect(pc.verify_message(sample, { ...highS, s: highS.s + 1n }, pk)).toBe(false);
  });

  it('another message under the same signature is refused', () => {
    expect(pc.verify_message(utf8('sampld'), highS, pk)).toBe(false);
  });

  it('wrong key (the YubiKey device key) is refused', () => {
    expect(pc.verify_message(sample, highS, yubikey.deviceKey)).toBe(false);
  });

  it('a real YubiKey WebAuthn signature verifies; a changed origin does not', () => {
    const cd = utf8(yubikey.clientDataJSON);
    expect(pc.verify_device_signature(yubikey.authenticatorData, cd, yubikey.signature, yubikey.deviceKey)).toBe(true);
    const moved = utf8(yubikey.clientDataJSON.replace('http://localhost:5000', 'https://example.co.uk'));
    expect(pc.verify_device_signature(yubikey.authenticatorData, moved, yubikey.signature, yubikey.deviceKey)).toBe(false);
  });
});

describe('AC-2 01-G3: malleability, and a contract-level low-s rule', () => {
  it('raw verify accepts BOTH (r, s) and (r, n - s): no low-s rule in the stdlib', () => {
    expect(highS.s > P256_N / 2n).toBe(true);
    expect(pc.verify_message(sample, highS, pk)).toBe(true);
    expect(pc.verify_message(sample, rfc6979LowS, pk)).toBe(true);
  });

  it('verify_low_s accepts the low-s form and refuses the high-s form', async () => {
    const [lh, ll] = limbs(rfc6979LowS.s);
    expect(pc.verify_low_s(sample, rfc6979LowS.r, lh, ll, pk)).toBe(true);
    const [hh, hl] = limbs(highS.s);
    const o = await outcome(() => pc.verify_low_s(sample, highS.r, hh, hl, pk));
    expect(o).toMatchObject({ kind: 'rejected' });
    expect(o.kind === 'rejected' && o.message).toMatch(/high-s signature refused/);
  });
});

describe('01-G2: the unbound-digest anti-pattern', () => {
  it('verify_digest_UNSAFE says "verified" for an action the signer never saw', () => {
    // The app claims to authorise "pay-me" but passes the digest of "sample",
    // which the key did sign. The circuit has no message input, so it cannot
    // tell, and answers true.
    const claimedAction = utf8('pay-me');
    expect(pc.verify_digest_UNSAFE(sha(sample), highS, pk)).toBe(true);
    // The safe form, given the claimed action, refuses.
    expect(pc.verify_message(claimedAction, highS, pk)).toBe(false);
  });
});

describe('AC-2 hostile keys and scalars are refused, never accepted', () => {
  const cases: Array<[string, () => boolean]> = [
    ['01-G1 identity key', () => pc.verify_message(sample, highS, { x: 0n, y: 0n, identity: true })],
    ['01-G4 off-curve key', () => pc.verify_message(sample, highS, { x: 1n, y: 1n, identity: false })],
    ['01-G4 r = 0', () => pc.verify_message(sample, { ...highS, r: 0n }, pk)],
    ['01-G4 s = 0', () => pc.verify_message(sample, { ...highS, s: 0n }, pk)],
    ['01-G4 r = n', () => pc.verify_message(sample, { ...highS, r: P256_N }, pk)],
    ['01-G4 s = n', () => pc.verify_message(sample, { ...highS, s: P256_N }, pk)],
    ['01-G4 s = n + s (out of range, same residue)', () => pc.verify_message(sample, { ...highS, s: P256_N + highS.s }, pk)],
  ];

  it.each(cases)('%s', async (_name, run) => {
    const o = await outcome(run);
    // The security property: never `true`.
    expect(o).not.toEqual({ kind: 'value', value: true });
    // Record HOW it was refused; see the observations table in the README.
    console.log(`[01-G1/G4] ${_name}: ${o.kind === 'rejected' ? `rejected: ${o.message.split('\n')[0]}` : `returned ${o.value}`}`);
  });
});

describe('01-G8: persistentHash<Bytes<N>> is SHA-256', () => {
  it('matches node:crypto for 6 and 180 bytes', () => {
    expect(Buffer.from(pc.sha256_6(sample)).toString('hex')).toBe(Buffer.from(sha(sample)).toString('hex'));
    const cd = utf8(yubikey.clientDataJSON);
    expect(Buffer.from(pc.sha256_180(cd)).toString('hex')).toBe(Buffer.from(sha(cd)).toString('hex'));
  });
});

// Keep noble imported for the curve order sanity check.
it('P256_N is the curve order', () => expect(P256_N).toBe(p256.Point.CURVE().n));
