// This file is part of example-voting.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// In-memory tests: the compiled contract runs with compact-runtime, with no
// network and no proofs. `npm run compile:fast && npm run test:sim` runs them in
// seconds; put contract logic, every guard and the privacy invariants here,
// and keep the devnet suite (voting.test.ts) for the end-to-end flow.
// `npm run new:example -- voting --derive` (repo root) fills the @generated-stub
// regions from the compiled contract; once you edit a region it is left alone.

import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from './sim.js';
import { Contract, ledger, Phase } from '../../contract/managed/voting/contract/index.js';
// @generated-stub begin coin-imports sha=e3b0c44298fc
// @generated-stub end coin-imports
import { createVotingPrivateState, witnesses, Vote } from '../../contract/witnesses.js';
import {
  adminKey,
  ballotCommit,
  checkOpening,
  voteInstance,
  ballotNullifier,
  ballotSalt,
  newAdminEncryptionKeys,
  newSecretKey,
  openBallot,
  ownOpening,
  passes,
  proposalIdFromLabel,
  sealBallot,
  voterKey,
} from '../crypto.js';

const PID = proposalIdFromLabel('MIP-0018');
const ADMIN_SK = newSecretKey();
const T0 = 1_800_000_000;
const HOUR = 3600;
const DEADLINE = T0 + 7 * 24 * HOUR;
const WINDOW = 48 * HOUR;

const deploy = () =>
  Sim.deploy({
    contract: new Contract(witnesses),
    ledger,
    // @generated-stub begin private-state sha=b9a96042d633
    privateState: createVotingPrivateState(ADMIN_SK),
    // @generated-stub end private-state
    // @generated-stub begin constructor-args sha=e6557b886e53
    args: [PID],
    // @generated-stub end constructor-args
  });

type VotingSim = Awaited<ReturnType<typeof deploy>>;

/** The proposal id and contract address that nullifiers, salts and blobs are bound to. */
const V = (sim: VotingSim) => voteInstance(PID, sim.address);

// Everything above is generated boilerplate. Your tests begin here.

const asAdmin = (sim: VotingSim) => {
  sim.privateState = createVotingPrivateState(ADMIN_SK);
  return sim;
};

/** A deployed vote with `voters` enrolled, both admin keys published, opened at T0. */
const setup = async (nVoters = 3) => {
  const sim = (await deploy()).at(T0);
  const voters = Array.from({ length: nVoters }, () => newSecretKey());
  const admins = [newAdminEncryptionKeys(), newAdminEncryptionKeys()];
  for (const sk of voters) await sim.call('enrol', voterKey(sk));
  for (const a of admins) await sim.call('addAdminKey', a.publicKey);
  await sim.call('open', BigInt(DEADLINE));
  return { sim, voters, admins, adminKeys: admins.map((a) => a.publicKey) };
};

const cast = async (sim: VotingSim, sk: Uint8Array, vote: Vote, adminKeys: Uint8Array[], blob?: Uint8Array) => {
  sim.privateState = createVotingPrivateState(sk, vote);
  return sim.call('cast', blob ?? sealBallot({ vote, salt: ballotSalt(sk, V(sim)) }, adminKeys, V(sim)));
};

/**
 * The admin's count, as scripts/cli.ts does it: decrypt every uncounted blob,
 * check the opening against the stored commitment, and submit the ones that
 * match. Returns the ballots it had to skip (their voters can self-count).
 */
const adminCount = async (sim: VotingSim, adminSecretKey: Uint8Array) => {
  const skipped: Uint8Array[] = [];
  for (const [n, blob] of sim.ledger().encBallots) {
    if (sim.ledger().counted.member(n)) continue;
    const opening = openBallot(blob, adminSecretKey, V(sim));
    if (opening === undefined || !checkOpening(opening, sim.ledger().ballots.lookup(n))) skipped.push(n);
    else await sim.call('count', n, opening.vote, opening.salt);
  }
  return skipped;
};

describe('Voting (in memory)', () => {
  it('deploys in enrolment with the admin and proposal set', async () => {
    const l = (await deploy()).ledger();
    expect(l.phase).toBe(Phase.ENROLMENT);
    expect(l.proposalId).toEqual(PID);
    expect(l.adminPk).toEqual(adminKey(ADMIN_SK));
    expect(l.enrolled).toBe(0n);
  });

  it('runs a whole vote: enrol, open, cast, close at the deadline, count, result', async () => {
    const { sim, voters, admins, adminKeys } = await setup(4);
    const l0 = sim.ledger();
    expect(l0.phase).toBe(Phase.OPEN);
    expect(l0.deadline).toBe(BigInt(DEADLINE));
    expect(l0.countingEnds).toBe(BigInt(DEADLINE + WINDOW));

    const votes = [Vote.YES, Vote.NO, Vote.YES, Vote.ABSTAIN];
    for (let i = 0; i < voters.length; i++) await cast(sim.at(T0 + 60 * i), voters[i], votes[i], adminKeys);
    expect(sim.ledger().castCount).toBe(4n);
    expect(sim.ledger().ballots.member(ballotNullifier(voters[0], V(sim)))).toBe(true);

    sim.at(DEADLINE + HOUR);
    expect(await adminCount(sim, admins[0].secretKey)).toEqual([]);
    const l = sim.ledger();
    expect([l.yes, l.no, l.abstain]).toEqual([2n, 1n, 1n]);
    expect(l.counted.size()).toBe(4n);
    expect(passes(l)).toBe(true);
  });

  it('lets any admin key decrypt every ballot', async () => {
    const { sim, voters, admins, adminKeys } = await setup(2);
    await cast(sim, voters[0], Vote.NO, adminKeys);
    const [[, blob]] = [...sim.ledger().encBallots];
    for (const a of admins) expect(openBallot(blob, a.secretKey, V(sim))?.vote).toBe(Vote.NO);
    expect(openBallot(blob, newAdminEncryptionKeys().secretKey, V(sim))).toBeUndefined();
  });

  describe('enrol, addAdminKey, open', () => {
    it('only the admin can call them', async () => {
      const sim = (await deploy()).at(T0);
      sim.privateState = createVotingPrivateState(newSecretKey());
      await expectRejects(() => sim.call('enrol', voterKey(newSecretKey())), 'Only the admin can do this');
      await expectRejects(() => sim.call('addAdminKey', newAdminEncryptionKeys().publicKey), 'Only the admin can do this');
      await expectRejects(() => sim.call('open', BigInt(DEADLINE)), 'Only the admin can do this');
    });

    it('rejects enrolling more voters than the tree holds (1,024)', { timeout: 300_000 }, async () => {
      const sim = await deploy();
      for (let i = 0; i < 1024; i++) await sim.call('enrol', voterKey(newSecretKey()));
      expect(sim.ledger().voters.isFull()).toBe(true);
      await expectRejects(() => sim.call('enrol', voterKey(newSecretKey())), 'Voter list is full');
    });

    it('rejects enrolling a key twice', async () => {
      const sim = await deploy();
      const pk = voterKey(newSecretKey());
      await sim.call('enrol', pk);
      await expectRejects(() => sim.call('enrol', pk), 'Voter already enrolled');
    });

    it('refuses to open with no voters, no admin key, or a deadline in the past', async () => {
      const sim = (await deploy()).at(T0);
      await expectRejects(() => sim.call('open', BigInt(DEADLINE)), 'No voters enrolled');
      await sim.call('enrol', voterKey(newSecretKey()));
      await expectRejects(() => sim.call('open', BigInt(DEADLINE)), 'No admin encryption key');
      await sim.call('addAdminKey', newAdminEncryptionKeys().publicKey);
      await expectRejects(() => sim.call('open', BigInt(T0 - 1)), 'Deadline is in the past');
      await expectRejects(() => sim.call('open', 10n ** 12n), 'Deadline out of range');
      await sim.call('open', BigInt(DEADLINE));
      await expectRejects(() => sim.call('open', BigInt(DEADLINE)), 'Voting already opened');
    });

    it('freezes the voter list and admin keys once voting opens', async () => {
      const { sim } = await setup();
      asAdmin(sim);
      await expectRejects(() => sim.call('enrol', voterKey(newSecretKey())), 'Enrolment is closed');
      await expectRejects(() => sim.call('addAdminKey', newAdminEncryptionKeys().publicKey), 'Enrolment is closed');
    });
  });

  describe('cast', () => {
    it('rejects a cast before voting opens', async () => {
      const sim = (await deploy()).at(T0);
      const sk = newSecretKey();
      await sim.call('enrol', voterKey(sk));
      sim.privateState = createVotingPrivateState(sk, Vote.YES);
      await expectRejects(() => sim.call('cast', new Uint8Array(8)), 'Voting is not open');
    });

    it('rejects a voter who is not enrolled', async () => {
      const { sim, adminKeys } = await setup();
      await expectRejects(() => cast(sim, newSecretKey(), Vote.YES, adminKeys), 'not enrolled');
    });

    it('rejects a borrowed path for another voter, and a forged path', async () => {
      const { sim, voters, adminKeys } = await setup();
      const outsider = newSecretKey();
      const blob = sealBallot({ vote: Vote.YES, salt: ballotSalt(outsider, V(sim)) }, adminKeys, V(sim));
      // An outsider replays an enrolled voter's (public) path.
      const borrowed = new Contract({
        ...witnesses,
        voterPath: ({ privateState, ledger: l }) => [privateState, l.voters.findPathForLeaf(voterKey(voters[0]))!],
      });
      const s1 = await Sim.deploy({ contract: borrowed, ledger, privateState: createVotingPrivateState(ADMIN_SK), args: [PID] });
      s1.at(T0);
      await s1.call('enrol', voterKey(voters[0]));
      await s1.call('addAdminKey', adminKeys[0]);
      await s1.call('open', BigInt(DEADLINE));
      s1.privateState = createVotingPrivateState(outsider, Vote.YES);
      await expectRejects(() => s1.call('cast', blob), 'Path is not for this voter');
      // An outsider builds a path for their own key against a tree they aren't in.
      const forged = new Contract({
        ...witnesses,
        voterPath: ({ privateState, ledger: l }, pk) => [privateState, l.voters.pathForLeaf(0n, pk)],
      });
      const s2 = await Sim.deploy({ contract: forged, ledger, privateState: createVotingPrivateState(ADMIN_SK), args: [PID] });
      s2.at(T0);
      await s2.call('enrol', voterKey(voters[0]));
      await s2.call('addAdminKey', adminKeys[0]);
      await s2.call('open', BigInt(DEADLINE));
      s2.privateState = createVotingPrivateState(outsider, Vote.YES);
      await expectRejects(() => s2.call('cast', blob), 'Not an enrolled voter');
      expect(sim.ledger().castCount).toBe(0n);
    });

    it('rejects a second cast by the same voter, even with a different vote', async () => {
      const { sim, voters, adminKeys } = await setup();
      await cast(sim, voters[0], Vote.YES, adminKeys);
      await expectRejects(() => cast(sim, voters[0], Vote.NO, adminKeys), 'Already voted');
    });

    it('rejects a cast at or after the deadline, and after an early close', async () => {
      const { sim, voters, adminKeys } = await setup(2);
      await expectRejects(() => cast(sim.at(DEADLINE), voters[0], Vote.YES, adminKeys), 'Voting is closed');
      await cast(sim.at(DEADLINE - 1), voters[0], Vote.YES, adminKeys);
      await cast(sim.at(T0 + HOUR), voters[1], Vote.YES, adminKeys);
      await asAdmin(sim).call('closeEarly');
      await expectRejects(() => cast(sim, voters[1], Vote.NO, adminKeys), 'Voting is closed');
    });

    it('gives the same voter unlinkable nullifiers in different proposals', async () => {
      const sim = await deploy();
      const sk = newSecretKey();
      const other = voteInstance(proposalIdFromLabel('MIP-0019'), sim.address);
      expect(ballotNullifier(sk, V(sim))).not.toEqual(ballotNullifier(sk, other));
    });
  });

  describe('closeEarly', () => {
    it('only once every enrolled voter has cast, and only by the admin', async () => {
      const { sim, voters, adminKeys } = await setup(2);
      sim.at(T0 + HOUR);
      await cast(sim, voters[0], Vote.YES, adminKeys);
      await expectRejects(() => asAdmin(sim).call('closeEarly'), 'Not every voter has cast');
      await cast(sim, voters[1], Vote.NO, adminKeys);
      sim.privateState = createVotingPrivateState(voters[0]);
      await expectRejects(() => sim.call('closeEarly'), 'Only the admin can do this');
      await asAdmin(sim).call('closeEarly');
      expect(sim.ledger().closedEarly).toBe(true);
      await expectRejects(() => sim.call('closeEarly'), 'Voting is closed');
    });

    it('never shortens the counting window (voters keep the announced self-count time)', async () => {
      const { sim, voters, adminKeys } = await setup(1);
      await cast(sim.at(T0 + 60), voters[0], Vote.YES, adminKeys);
      await asAdmin(sim).call('closeEarly');
      expect(sim.ledger().countingEnds).toBe(BigInt(DEADLINE + WINDOW));
    });

    it('rejects an early close once the deadline has passed', async () => {
      const { sim, voters, adminKeys } = await setup(1);
      await cast(sim, voters[0], Vote.YES, adminKeys);
      asAdmin(sim.at(DEADLINE));
      await expectRejects(() => sim.call('closeEarly'), 'Deadline already passed');
    });
  });

  describe('count', () => {
    it('is not allowed while voting is open, nor after the counting window', async () => {
      const { sim, voters, adminKeys } = await setup();
      await cast(sim, voters[0], Vote.YES, adminKeys);
      const n = ballotNullifier(voters[0], V(sim));
      const { vote, salt } = ownOpening(voters[0], V(sim), Vote.YES);
      await expectRejects(() => sim.at(DEADLINE - 1).call('count', n, vote, salt), 'Voting is still open');
      await expectRejects(() => sim.at(DEADLINE + WINDOW).call('count', n, vote, salt), 'Counting window has ended');
      await sim.at(DEADLINE + WINDOW - 1).call('count', n, vote, salt);
    });

    it('is not allowed before voting opens', async () => {
      const sim = await deploy();
      await expectRejects(() => sim.call('count', new Uint8Array(32), Vote.YES, new Uint8Array(32)), 'Voting has not opened');
    });

    it('opens right after an early close', async () => {
      const { sim, voters, admins, adminKeys } = await setup(1);
      await cast(sim.at(T0 + 60), voters[0], Vote.YES, adminKeys);
      await asAdmin(sim).call('closeEarly');
      await adminCount(sim.at(T0 + 120), admins[1].secretKey);
      expect(sim.ledger().yes).toBe(1n);
    });

    it('rejects a changed vote, a wrong salt, an unknown ballot and a double count', async () => {
      const { sim, voters, adminKeys } = await setup();
      await cast(sim, voters[0], Vote.NO, adminKeys);
      sim.at(DEADLINE);
      const n = ballotNullifier(voters[0], V(sim));
      const salt = ballotSalt(voters[0], V(sim));
      await expectRejects(() => sim.call('count', n, Vote.YES, salt), 'Opening does not match the ballot');
      await expectRejects(() => sim.call('count', n, Vote.NO, newSecretKey()), 'Opening does not match the ballot');
      await expectRejects(() => sim.call('count', newSecretKey(), Vote.NO, salt), 'No such ballot');
      await sim.call('count', n, Vote.NO, salt);
      await expectRejects(() => sim.call('count', n, Vote.NO, salt), 'Ballot already counted');
      expect([sim.ledger().yes, sim.ledger().no]).toEqual([0n, 1n]);
    });

    it('a ballot with an unreadable blob is skipped by the admin and counted by its voter', async () => {
      const { sim, voters, admins, adminKeys } = await setup(2);
      await cast(sim, voters[0], Vote.YES, adminKeys);
      await cast(sim, voters[1], Vote.NO, adminKeys, new Uint8Array([1, 2, 3]));
      sim.at(DEADLINE + HOUR);
      const unreadable = await adminCount(sim, admins[0].secretKey);
      expect(unreadable).toEqual([ballotNullifier(voters[1], V(sim))]);
      // Uncounted ballots stay visible on chain.
      const uncounted = [...sim.ledger().ballots].filter(([n]) => !sim.ledger().counted.member(n));
      expect(uncounted).toHaveLength(1);
      // Fallback: the voter rebuilds the opening from their secret. Anyone may submit it.
      const { vote, salt } = ownOpening(voters[1], V(sim), Vote.NO);
      sim.privateState = createVotingPrivateState(newSecretKey());
      await sim.call('count', ballotNullifier(voters[1], V(sim)), vote, salt);
      expect([sim.ledger().yes, sim.ledger().no]).toEqual([1n, 1n]);
      expect(passes(sim.ledger())).toBe(false); // a tie fails
    });
  });

  describe('cross-deployment unlinkability', () => {
    it('gives the same voter different nullifiers and commitments in two deployments of the same proposal', async () => {
      const sk = newSecretKey();
      const fresh = async () => {
        const sim = (await deploy()).at(T0);
        await sim.call('enrol', voterKey(sk));
        await sim.call('addAdminKey', newAdminEncryptionKeys().publicKey);
        await sim.call('open', BigInt(DEADLINE));
        await cast(sim, sk, Vote.NO, [...sim.ledger().adminEncKeys]);
        return [...sim.ledger().ballots][0];
      };
      const [n1, c1] = await fresh();
      const [n2, c2] = await fresh();
      expect(n1).not.toEqual(n2);
      expect(c1).not.toEqual(c2);
    });
  });

  it('the admin skips a blob whose opening does not match, and counts the rest', async () => {
    const { sim, voters, admins, adminKeys } = await setup(3);
    // voters[0] commits YES but seals an opening that says NO: it decrypts, but doesn't match.
    const lie = sealBallot({ vote: Vote.NO, salt: ballotSalt(voters[0], V(sim)) }, adminKeys, V(sim));
    await cast(sim, voters[0], Vote.YES, adminKeys, lie);
    await cast(sim, voters[1], Vote.NO, adminKeys);
    await cast(sim, voters[2], Vote.ABSTAIN, adminKeys);
    const skipped = await adminCount(sim.at(DEADLINE), admins[0].secretKey);
    expect(skipped).toEqual([ballotNullifier(voters[0], V(sim))]);
    expect([sim.ledger().yes, sim.ledger().no, sim.ledger().abstain]).toEqual([0n, 1n, 1n]);
    expect(ballotCommit(Vote.YES, ballotSalt(voters[0], V(sim)))).toEqual(
      sim.ledger().ballots.lookup(ballotNullifier(voters[0], V(sim))),
    );
  });

  it('a low-order admin key published next to a good one does not block casting or counting', async () => {
    const sim = (await deploy()).at(T0);
    const voters = [newSecretKey(), newSecretKey()];
    const admin = newAdminEncryptionKeys();
    for (const sk of voters) await sim.call('enrol', voterKey(sk));
    // The contract can't tell a low-order X25519 key from a good one; the CLI refuses it.
    await sim.call('addAdminKey', new Uint8Array(32));
    await sim.call('addAdminKey', admin.publicKey);
    await sim.call('open', BigInt(DEADLINE));
    const published = [...sim.ledger().adminEncKeys];
    expect(published).toHaveLength(2);
    await cast(sim, voters[0], Vote.YES, published);
    await cast(sim, voters[1], Vote.NO, published);
    expect(await adminCount(sim.at(DEADLINE), admin.secretKey)).toEqual([]);
    expect([sim.ledger().yes, sim.ledger().no, sim.ledger().abstain]).toEqual([1n, 1n, 0n]);
  });

  // @generated-stub begin circuits sha=445b258edf5d
  // Covered by the describe blocks above.
  // @generated-stub end circuits

  // @generated-stub begin privacy sha=0509db7fe4f5
  // SPEC.md → Privacy invariants: one entry per "never on chain" line.
  it('keeps secrets out of public state', async () => {
    const { sim, voters, adminKeys } = await setup(2);
    await cast(sim, voters[0], Vote.YES, adminKeys);
    await cast(sim, voters[1], Vote.ABSTAIN, adminKeys);
    const l = sim.ledger();
    expect(Object.keys(l).sort()).toEqual(['abstain', 'adminEncKeys', 'adminPk', 'ballots', 'castCount', 'closedEarly', 'counted', 'countingEnds', 'deadline', 'encBallots', 'enrolled', 'no', 'phase', 'proposalId', 'voterKeys', 'voters', 'yes']);
    assertNotInPublicState(l, {
      voterSecretKey0: voters[0],
      voterSecretKey1: voters[1],
      ballotSalt0: ballotSalt(voters[0], V(sim)),
      ballotSalt1: ballotSalt(voters[1], V(sim)),
      adminSecretKey: ADMIN_SK,
    });
  });
  // @generated-stub end privacy
});
