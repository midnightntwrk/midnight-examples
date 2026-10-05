// Guards the fixtures themselves: every vector must verify (or fail) OFF-circuit
// with @noble/curves before an in-circuit result means anything.
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8 } from '../encode.js';
import { cardanoPayment, long1023, rfcTest1, rfcTest2, rfcTestShaAbc } from '../fixtures/ed25519.js';
import { assert, challengeText, clientDataJSON, deviceKey, rfc6979, rfc6979LowS, yubikey } from '../fixtures/p256.js';

const sig = (r: bigint, s: bigint) => new p256.Signature(r, s).toBytes('compact');
const pub = (k: { x: bigint; y: bigint }) => p256.Point.fromAffine(k).toBytes(false);

describe('fixtures verify off-circuit', () => {
  it.each([rfcTest1, rfcTest2, rfcTestShaAbc, cardanoPayment, long1023])('ed25519: $name', (v) => {
    expect(ed25519.verify(v.signature, v.message, v.publicKey)).toBe(true);
  });

  it('p256: RFC 6979 A.2.5, high-s as published and its low-s twin', () => {
    const msg = rfc6979.message;
    expect(rfc6979.signature.s > p256.Point.CURVE().n / 2n).toBe(true);
    // noble's verify defaults to lowS: true, so the published high-s form needs lowS: false.
    expect(p256.verify(sig(rfc6979.signature.r, rfc6979.signature.s), msg, pub(rfc6979.publicKey), { lowS: false })).toBe(true);
    expect(p256.verify(sig(rfc6979LowS.r, rfc6979LowS.s), msg, pub(rfc6979.publicKey))).toBe(true);
  });

  it('p256: YubiKey WebAuthn registration signature', () => {
    const signed = Uint8Array.from([...yubikey.authenticatorData, ...sha256(utf8(yubikey.clientDataJSON))]);
    expect(utf8(yubikey.clientDataJSON).length).toBe(180);
    expect(yubikey.authenticatorData.length).toBe(196);
    expect(p256.verify(sig(yubikey.signature.r, yubikey.signature.s), signed, pub(yubikey.deviceKey), { lowS: false })).toBe(true);
  });

  it('passkey layout matches the 131-byte clientDataJSON the contract rebuilds', () => {
    const c = challengeText(0);
    expect(c).toHaveLength(43);
    const json = clientDataJSON(c);
    expect(utf8(json).length).toBe(131);
    // signature_auth.compact pads these two constants to exactly 36 and 52 bytes;
    // pad() would silently zero-fill a shorter string, so pin the lengths here.
    expect(utf8('{"type":"webauthn.get","challenge":"').length).toBe(36);
    expect(utf8('","origin":"https://q3.example","crossOrigin":false}').length).toBe(52);
    const a = assert(c);
    expect(deviceKey.length).toBe(65);
    expect(a.signature.length).toBe(64);
  });
});
