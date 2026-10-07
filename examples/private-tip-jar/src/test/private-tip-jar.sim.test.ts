// In-memory tests for the tip jar: every guard, the tip → withdraw flow, and
// the privacy invariants in SPEC.md, with no network and no proofs.
// `yarn compile:fast` then `yarn test:sim`. The devnet suite in
// private-tip-jar.test.ts runs the same flow with real wallets and coins.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects, findInPublicState } from '@midnight-ntwrk/example-sim';
import { Contract, ledger, pureCircuits } from '../../contract/managed/private-tip-jar/contract/index.js';
import { createPrivateTipJarPrivateState, witnesses } from '../../contract/witnesses.js';

const bytes32 = () => new Uint8Array(randomBytes(32));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const OWNER_SK = bytes32();
const OWNER_COIN_PK = hex(bytes32());
const TIP_COLOR = bytes32();

const deploy = () =>
  Sim.deploy({
    contract: new Contract(witnesses),
    ledger,
    privateState: createPrivateTipJarPrivateState(OWNER_SK),
    args: [TIP_COLOR],
    coinPublicKey: OWNER_COIN_PK,
  });

// Everything above is generated boilerplate. Your tests begin here.

const coin = (value: bigint, color = TIP_COLOR) => ({ nonce: bytes32(), color, value });

describe('private tip jar (in memory)', () => {
  it('stores the owner as a hash of the secret key, and the accepted color', () => {
    const l = deploy().ledger();
    expect(l.owner).toEqual(pureCircuits.ownerKey(OWNER_SK));
    expect(l.tipColor).toEqual(TIP_COLOR);
    expect(l.pot.isEmpty()).toBe(true);
  });

  it('accepts a tip and re-nonces it to the contract', () => {
    const sim = deploy();
    const tip = coin(5n);
    const { ledger: l } = sim.as(hex(bytes32())).call('tip', tip);
    expect(l.pot.size()).toBe(1n);
    const [[key, held]] = [...l.pot];
    expect(held.value).toBe(5n);
    expect(held.color).toEqual(TIP_COLOR);
    expect(key).toEqual(held.nonce);
    expect(held.nonce).not.toEqual(tip.nonce);
  });

  it('rejects a tip in the wrong token or worth nothing', () => {
    const sim = deploy();
    expectRejects(() => sim.call('tip', coin(5n, bytes32())), "Tips must be paid in the jar's token");
    expectRejects(() => sim.call('tip', coin(0n)), 'A tip must be worth something');
    expect(sim.ledger().pot.isEmpty()).toBe(true);
  });

  it('lets only the owner withdraw, and only an existing tip', () => {
    const sim = deploy();
    sim.call('tip', coin(7n));
    const [[key]] = [...sim.ledger().pot];

    sim.privateState = createPrivateTipJarPrivateState(bytes32());
    expectRejects(() => sim.call('withdraw', key), 'Only the owner can withdraw');

    sim.privateState = createPrivateTipJarPrivateState(OWNER_SK);
    expectRejects(() => sim.call('withdraw', bytes32()), 'No such tip in the jar');

    expect(sim.as(OWNER_COIN_PK).call('withdraw', key).ledger.pot.isEmpty()).toBe(true);
  });

  // SPEC.md → Privacy invariants. One entry per "never on chain" line.
  it('keeps the tippers, their coins and the owner secret out of public state', () => {
    const sim = deploy();
    const tippers = [bytes32(), bytes32()];
    const tips = [coin(3n), coin(4n)];
    tips.forEach((t, i) => sim.as(hex(tippers[i]!)).call('tip', t));

    const l = sim.ledger();
    expect(Object.keys(l).sort()).toEqual(['owner', 'pot', 'tipColor']);
    // Control: the contract's own (re-nonced) coin is public, and is found.
    const [[, held]] = [...l.pot];
    expect(findInPublicState(l, held.nonce)).toBe('pot[0].key');
    assertNotInPublicState(l, {
      ownerSecretKey: OWNER_SK,
      ownerCoinPublicKey: Buffer.from(OWNER_COIN_PK, 'hex'),
      tipperCoinPublicKey0: tippers[0]!,
      tipperCoinPublicKey1: tippers[1]!,
      tipperCoinNonce0: tips[0]!.nonce,
      tipperCoinNonce1: tips[1]!.nonce,
    });
  });
});
