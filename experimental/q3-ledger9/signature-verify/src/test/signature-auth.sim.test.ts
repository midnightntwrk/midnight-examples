// SOW-Q3-01 in DApp shape, at L1: signature_auth.compact run in memory.
import { beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { outcome, Simulator } from '@q3/harness/sim';
import { Contract, ledger } from '../../contract/managed/signature_auth/contract/index.js';
import { pureCircuits as ed } from '../../contract/managed/ed25519_vectors/contract/index.js';
import { edPoint, edSignature, hex, p256Point, p256Signature, utf8 } from '../encode.js';
import { otherSecret, testSecret } from '../fixtures/ed25519.js';
import { assert, challengeText, deviceKey, rpIdHash } from '../fixtures/p256.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { witnesses, type SignatureAuthPrivateState as PS } from '../witnesses.js';
import { toHex } from '../encode.js';

const actionId = (label: string) => sha256(utf8(label));
const signerKey = edPoint(ed25519.getPublicKey(testSecret));
const ownerCommitment = ed.commit_key(edPoint(ed25519.getPublicKey(testSecret)));

async function deploy(secret = testSecret) {
  return Simulator.deploy<PS>(new Contract(witnesses as never) as never, { ownerSecretHex: toHex(secret) }, [
    signerKey,
    ownerCommitment,
    p256Point(deviceKey),
    rpIdHash,
    utf8(challengeText(0)),
  ]);
}

const L = (sim: Simulator<PS>) => ledger(sim.state as never);

describe('AC-1 authorize_once (01-G10)', () => {
  let sim: Simulator<PS>;
  beforeEach(async () => (sim = await deploy()));

  it('accepts a signature by the registered signer and records the action id', async () => {
    const id = actionId('withdraw 10');
    await sim.call('authorize_once', id, edSignature(ed25519.sign(id, testSecret)));
    expect(L(sim).used.member(id)).toBe(true);
  });

  it('refuses a replay of the same authorisation', async () => {
    const id = actionId('withdraw 10');
    const sig = edSignature(ed25519.sign(id, testSecret));
    await sim.call('authorize_once', id, sig);
    const o = await outcome(() => sim.call('authorize_once', id, sig));
    expect(o.kind === 'rejected' && o.message).toMatch(/action already authorised/);
  });

  it('refuses a signature by another key', async () => {
    const id = actionId('withdraw 10');
    const o = await outcome(() => sim.call('authorize_once', id, edSignature(ed25519.sign(id, otherSecret))));
    expect(o.kind === 'rejected' && o.message).toMatch(/does not verify for the registered signer/);
  });

  it('refuses a genuine signature presented for a different action', async () => {
    const o = await outcome(() =>
      sim.call('authorize_once', actionId('withdraw 99'), edSignature(ed25519.sign(actionId('withdraw 10'), testSecret))),
    );
    expect(o.kind).toBe('rejected');
  });
});

describe('AC-1 authorize_private (01-G9): key and signature stay off-chain', () => {
  it('the committed owner authorises; the counter moves', async () => {
    const sim = await deploy();
    await sim.call('authorize_private', actionId('vote yes'));
    expect(L(sim).private_actions).toBe(1n);
  });

  it('a prover holding another key is refused by the commitment check', async () => {
    const sim = await deploy();
    sim.privateState = { ownerSecretHex: toHex(otherSecret) };
    const o = await outcome(() => sim.call('authorize_private', actionId('vote yes')));
    expect(o.kind === 'rejected' && o.message).toMatch(/witness key is not the committed owner/);
  });
});

describe('AC-2 passkey_action (01-G5): challenge, origin, RP and UP checked in-circuit', () => {
  let sim: Simulator<PS>;
  beforeEach(async () => (sim = await deploy()));

  const call = (a: ReturnType<typeof assert>, next: string) =>
    sim.call('passkey_action', a.flagsHi, a.signCount, p256Signature(a.signature), utf8(next));

  it('accepts a fresh assertion and rotates the challenge', async () => {
    await call(assert(challengeText(0)), challengeText(1));
    expect(Buffer.from(L(sim).challenge).toString()).toBe(challengeText(1));
    expect(L(sim).passkey_actions).toBe(1n);
  });

  it('refuses a replayed assertion: the challenge has moved on', async () => {
    const a = assert(challengeText(0));
    await call(a, challengeText(1));
    const o = await outcome(() => call(a, challengeText(2)));
    expect(o.kind === 'rejected' && o.message).toMatch(/passkey assertion does not verify/);
  });

  const refused: Array<[string, () => ReturnType<typeof assert>]> = [
    ['an assertion over a stale challenge', () => assert(challengeText(7))],
    ['another origin (phishing site)', () => assert(challengeText(0), { origin: 'https://q3.examp1e' })],
    ['a registration ceremony (type webauthn.create)', () => assert(challengeText(0), { type: 'webauthn.create' })],
    ['another relying party', () => assert(challengeText(0), { rpHash: sha256(utf8('evil.example')) })],
    ['user presence NOT asserted (flags 0x04: UV only)', () => assert(challengeText(0), { flags: 0x04 })],
    ['another device key', () => assert(challengeText(0), { secret: hex('11'.repeat(32)) })],
  ];
  it.each(refused)('refuses %s', async (_name, make) => {
    const o = await outcome(() => call(make(), challengeText(1)));
    expect(o.kind === 'rejected' && o.message).toMatch(/passkey assertion does not verify/);
    expect(Buffer.from(L(sim).challenge).toString()).toBe(challengeText(0));
  });

  it('sanity: the software device key is a valid P-256 point', () => {
    expect(() => p256.Point.fromBytes(deviceKey)).not.toThrow();
  });
});
