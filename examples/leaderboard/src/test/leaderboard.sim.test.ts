// In-memory tests for the leaderboard: every guard, the submit → verify flow,
// and the privacy invariants in SPEC.md, with no network and no proofs.
// `npm run compile:fast` then `npm run test:sim`. The network suite in
// leaderboard.test.ts runs the same flow with real wallets and proofs.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from './sim.js';
import { Contract, ledger, pureCircuits } from '../../contract/managed/leaderboard/contract/index.js';
import { createLeaderboardPrivateState, setCustomName, witnesses } from '../../contract/witnesses.js';

const bytes32 = () => new Uint8Array(randomBytes(32));

const ALICE_SK = bytes32();
const BOB_SK = bytes32();

const deploy = () =>
  Sim.deploy({
    contract: new Contract(witnesses),
    ledger,
    privateState: createLeaderboardPrivateState(ALICE_SK),
  });

// Everything above is generated boilerplate. Your tests begin here.

const nameBytes = (name: string) => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(name).slice(0, 32));
  return out;
};

describe('leaderboard (in memory)', () => {
  it('starts empty', async () => {
    const l = (await deploy()).ledger();
    expect(l.scores.isEmpty()).toBe(true);
    expect(l.nextId).toBe(0n);
  });

  it('stores a custom-name entry under the next id, with the owner commitment', async () => {
    const sim = await deploy();
    setCustomName('alice');
    const { ledger: l } = await sim.call('submitScore', 420n, true);
    expect(l.nextId).toBe(1n);
    const entry = l.scores.lookup(1n);
    expect(entry.score).toBe(420n);
    expect(entry.displayName).toEqual(nameBytes('alice'));
    expect(entry.ownerHash).toEqual(pureCircuits.ownerCommitment(ALICE_SK));
  });

  it('truncates a custom name to 32 bytes', async () => {
    const sim = await deploy();
    const long = 'x'.repeat(40);
    setCustomName(long);
    const { ledger: l } = await sim.call('submitScore', 1n, true);
    expect(l.scores.lookup(1n).displayName).toEqual(nameBytes(long.slice(0, 32)));
  });

  it('stores an anonymous entry with a hash of the key, never the key itself', async () => {
    const sim = await deploy();
    const { ledger: l } = await sim.call('submitScore', 7n, false);
    const entry = l.scores.lookup(1n);
    expect(entry.displayName).not.toEqual(ALICE_SK);
    expect(entry.displayName).not.toEqual(new Uint8Array(32));
    assertNotInPublicState(l, { aliceSecretKey: ALICE_SK });
  });

  it('adds a new entry for every submission, like an arcade cabinet', async () => {
    const sim = await deploy();
    await sim.call('submitScore', 10n, false);
    await sim.call('submitScore', 30n, false);
    sim.privateState = createLeaderboardPrivateState(BOB_SK);
    const { ledger: l } = await sim.call('submitScore', 20n, false);
    expect(l.nextId).toBe(3n);
    expect(l.scores.size()).toBe(3n);
    // A Map's iteration order is not insertion order, so sort by id.
    const byId = [...l.scores].map(([id, e]) => [id, e.score]).sort((a, b) => Number(a[0] - b[0]));
    expect(byId).toEqual([
      [1n, 10n],
      [2n, 30n],
      [3n, 20n],
    ]);
    // Alice's two entries carry the same commitment: entries by one key are linkable.
    expect(l.scores.lookup(1n).ownerHash).toEqual(l.scores.lookup(2n).ownerHash);
    expect(l.scores.lookup(3n).ownerHash).not.toEqual(l.scores.lookup(1n).ownerHash);
  });

  it('lets the owner prove ownership, and changes no state doing it', async () => {
    const sim = await deploy();
    await sim.call('submitScore', 99n, false);
    const before = sim.ledger();
    const { ledger: after } = await sim.call('verifyOwnership', 1n);
    expect(after.nextId).toBe(before.nextId);
    expect(after.scores.size()).toBe(before.scores.size());
  });

  it('rejects an ownership proof from another key', async () => {
    const sim = await deploy();
    await sim.call('submitScore', 99n, false);
    sim.privateState = createLeaderboardPrivateState(BOB_SK);
    await expectRejects(() => sim.call('verifyOwnership', 1n), 'not the owner');
  });

  it('rejects an ownership proof for an entry that does not exist', async () => {
    const sim = await deploy();
    await expectRejects(() => sim.call('verifyOwnership', 1n), 'entry not found');
  });

  it('never puts a secret key in public state', async () => {
    const sim = await deploy();
    setCustomName('alice');
    await sim.call('submitScore', 5n, true);
    await sim.call('submitScore', 6n, false);
    sim.privateState = createLeaderboardPrivateState(BOB_SK);
    await sim.call('submitScore', 8n, false);
    await sim.call('verifyOwnership', 3n);
    assertNotInPublicState(sim.ledger(), { aliceSecretKey: ALICE_SK, bobSecretKey: BOB_SK });
  });
});
