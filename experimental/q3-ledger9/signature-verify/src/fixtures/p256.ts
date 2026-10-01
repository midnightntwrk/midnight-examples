// ECDSA P-256 fixtures. Checked off-circuit with @noble/curves in
// fixtures.test.ts before any circuit sees them.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { P256_N, b64url, hex, utf8 } from '../encode.js';

// RFC 6979 A.2.5, P-256 with SHA-256, message "sample". The RFC's own
// signature has a HIGH s (s > n/2); vendor QA at 672bc50 used it as is.
export const rfc6979 = {
  source: 'RFC 6979 A.2.5; compact-end-2-end@672bc50 secp256r1-ecdsa-verify.ts',
  message: utf8('sample'),
  publicKey: {
    x: 0x60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6n,
    y: 0x7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299n,
    identity: false,
  },
  signature: {
    r: 0xefd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716n,
    s: 0xf7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8n,
  },
};
// Its low-s twin (r, n - s): the same signature, malleated (gap 01-G3).
export const rfc6979LowS = { ...rfc6979.signature, s: P256_N - rfc6979.signature.s };

// A real YubiKey ("Security Key by Yubico with NFC") registration signature,
// from py_webauthn test_verify_attestation_from_yubikey_firefox @113487d5,
// as vendor QA used it. clientDataJSON is 180 bytes, authenticatorData 196.
export const yubikey = {
  source: 'py_webauthn@113487d5; compact-end-2-end@672bc50 secp256r1-yubikey-signature.ts',
  clientDataJSON:
    '{"type":"webauthn.create",' +
    '"challenge":"8LBCiOY3q1cBZHFAWtS4AZZChzGphy67lK7I70zKi4yC7pgrQ2Pch7nAjLk1wq9greshIAsW2AjibhXjjI0TmQ",' +
    '"origin":"http://localhost:5000",' +
    '"crossOrigin":false}',
  authenticatorData: hex(
    '49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763' +
      '45000000346d44ba9bf6ec2e49b9300c8fe920cb730040b321903c365151875b' +
      'e26deb7567b23da20c6256e6c9d1a9d533ffdf7bc4fe5a89dcf1cdc9377488ab' +
      '272abe568e709c07371eb19ac311f07f4412c5cd4de4e3a50102032620012158' +
      '20405ff8b73b70ef067906abfb8b364fcf7805f95b03bf308c41a749a15fa2f0' +
      'ef225820e5bed7e15c87cdbd31c5af4546001d35994f1e48c9c29218408bd54c' +
      'd468affc',
  ),
  deviceKey: {
    x: 0x2a03865e6043d99e11ff10aa25545784bf09af8e6b1e3b321729216f55121a8cn,
    y: 0xd910d399ddc768bdfe4a7bc7e3dabc62e6d2469ff5675b8ffa890cca74869e3fn,
    identity: false,
  },
  signature: {
    r: 0xe7eb1654296dabd3e9d25e4c3252083cd84983e30431e58b6facc93d9cd4888an,
    s: 0x31e60436cf97078dd417fa31074dbec97237d0a15496f1f5eccc5e6285281e38n,
  },
};

// ---- Software passkey (gap 01-G5) -----------------------------------------
//
// A hardware key cannot sign in CI, so the passkey_action tests use a software
// P-256 credential that produces byte-exact WebAuthn `get` assertions in the
// layout signature_auth.compact rebuilds. The YubiKey vector above keeps the
// real-device signature in the suite.

export const RP_ID = 'q3.example';
export const ORIGIN = 'https://q3.example';
export const rpIdHash = sha256(utf8(RP_ID));

export const deviceSecret = hex('6b7f4d1e9c2a5b8f0e3d6c9a2b5e8f1c4d7a0b3e6f9c2d5a8b1e4f7c0a3d6b9e');
export const deviceKey = p256.getPublicKey(deviceSecret, false);

/** The exact clientDataJSON the contract reconstructs. */
export const clientDataJSON = (challengeB64: string, origin = ORIGIN, type = 'webauthn.get') =>
  `{"type":"${type}","challenge":"${challengeB64}","origin":"${origin}","crossOrigin":false}`;

/** A deterministic 32-byte challenge, as its 43-char base64url text. */
export const challengeText = (seed: number): string =>
  b64url(sha256(utf8(`q3-challenge-${seed}`)));

export interface Assertion {
  flagsHi: bigint;
  signCount: Uint8Array;
  signature: Uint8Array; // compact r || s
}

/**
 * Signs a WebAuthn assertion over `challenge`. `flags` is the full flags byte
 * (bit 0 = UP). The contract takes flags_hi = flags >> 1 and forces UP on, so
 * an assertion made WITHOUT UP still fails: the authenticator signed a byte
 * with bit 0 clear, the contract rebuilds it with bit 0 set.
 */
export function assert(
  challenge: string,
  opts: { flags?: number; signCount?: number; origin?: string; type?: string; rpHash?: Uint8Array; secret?: Uint8Array } = {},
): Assertion {
  const flags = opts.flags ?? 0x05; // UP | UV
  const count = opts.signCount ?? 1;
  const signCount = Uint8Array.of((count >>> 24) & 0xff, (count >>> 16) & 0xff, (count >>> 8) & 0xff, count & 0xff);
  const authData = Uint8Array.from([...(opts.rpHash ?? rpIdHash), flags, ...signCount]);
  const cdHash = sha256(utf8(clientDataJSON(challenge, opts.origin, opts.type)));
  const signed = Uint8Array.from([...authData, ...cdHash]);
  // prehash: sha256(signed), matching persistentHash<Bytes<69>> in-circuit.
  const signature = p256.sign(signed, opts.secret ?? deviceSecret);
  return { flagsHi: BigInt(flags >> 1), signCount, signature };
}
