// In-memory tests for the election: every guard, the whole commit-reveal flow,
// and the per-deployment key binding, with no network and no proofs.
// `yarn compile:fast` then `yarn test:sim`. The devnet suite in
// election.test.ts runs the same flow with a real wallet.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from '@midnight-ntwrk/example-sim';
import { Contract, VoteChoice, VotingState, ledger, pureCircuits } from '../../contract/managed/election/contract/index.js';
import { createElectionPrivateState, witnesses } from '../../contract/witnesses.js';

const bytes32 = () => new Uint8Array(randomBytes(32));

const ORGANIZER_SK = bytes32();

const deploy = (instanceNonce = bytes32(), organizerSk = ORGANIZER_SK) =>
  Sim.deploy({
    contract: new Contract(witnesses),
    ledger,
    privateState: createElectionPrivateState(organizerSk, VoteChoice.BAD),
    args: ['Ada', 'Grace', instanceNonce],
  });

// Everything above is generated boilerplate. Your tests begin here.

type Election = ReturnType<typeof deploy>;

// A key's purpose, padded the way the contract's pad(32, "...") does it.
const pad32 = (s: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(s));
  return out;
};
// kernel.self().bytes of a deployment: its address, as raw bytes.
const addressBytes = (sim: Election) => new Uint8Array(Buffer.from(sim.address, 'hex'));

const organizerKey = (nonce: Uint8Array, sk: Uint8Array) =>
  pureCircuits.deriveKey(pad32('election:organizer:'), nonce, sk);
const voterKey = (sim: Election, sk: Uint8Array) =>
  pureCircuits.deriveKey(pad32('election:voter:'), addressBytes(sim), sk);

// Calls a circuit as whoever holds `sk`, voting `vote` where that matters.
const callAs = (sim: Election, sk: Uint8Array, circuit: Parameters<Election['call']>[0], vote = VoteChoice.BAD) => {
  sim.privateState = createElectionPrivateState(sk, vote);
  return sim.call(circuit);
};

// Deploys, registers `voters` and opens voting.
const openElection = (voters: Uint8Array[], nonce = bytes32()) => {
  const sim = deploy(nonce);
  voters.forEach((sk) => callAs(sim, sk, 'registerToVote'));
  callAs(sim, ORGANIZER_SK, 'openVoting');
  return sim;
};

describe('election (in memory)', () => {
  it('stores the instance nonce and an organizer key bound to it', () => {
    const nonce = bytes32();
    const l = deploy(nonce).ledger();
    expect(l.instanceNonce).toEqual(nonce);
    expect(l.organizer).toEqual(organizerKey(nonce, ORGANIZER_SK));
    expect(l.candidate0).toBe('Ada');
    expect(l.candidate1).toBe('Grace');
    expect(l.votingState).toBe(VotingState.CLOSED);
  });

  it('rejects a deployment without an instance nonce', () => {
    expectRejects(() => deploy(new Uint8Array(32)), 'The instance nonce must be random, not zero');
  });

  it('registers a voter under a key bound to this contract, once', () => {
    const sim = deploy();
    const voter = bytes32();
    const { ledger: l } = callAs(sim, voter, 'registerToVote');
    expect([...l.registeredVoters]).toEqual([voterKey(sim, voter)]);
    expectRejects(() => callAs(sim, voter, 'registerToVote'), 'You are already registered to vote');
  });

  it('lets only the organizer open voting, and only with a registered voter', () => {
    const sim = deploy();
    expectRejects(() => callAs(sim, ORGANIZER_SK, 'openVoting'), 'There are no registered voters');
    const voter = bytes32();
    callAs(sim, voter, 'registerToVote');
    expectRejects(() => callAs(sim, voter, 'openVoting'), 'You are not the organizer');
    expect(callAs(sim, ORGANIZER_SK, 'openVoting').ledger.votingState).toBe(VotingState.OPEN);
    expectRejects(() => callAs(sim, ORGANIZER_SK, 'openVoting'), 'Voting has already been openend');
    expectRejects(() => callAs(sim, bytes32(), 'registerToVote'), 'You can only register before voting starts');
  });

  it("doesn't accept the organizer's secret as a voter key", () => {
    // Same secret, different purpose: registering as a voter gives a key
    // unrelated to the organizer key, so neither can stand in for the other.
    const sim = deploy();
    const { ledger: l } = callAs(sim, ORGANIZER_SK, 'registerToVote');
    const [key] = [...l.registeredVoters];
    expect(key).not.toEqual(l.organizer);
  });

  it('accepts one valid vote per registered voter, while voting is open', () => {
    const voter = bytes32();
    const sim = deploy();
    callAs(sim, voter, 'registerToVote');
    expectRejects(() => callAs(sim, voter, 'commitVote'), 'Voting has not opened yet');
    callAs(sim, ORGANIZER_SK, 'openVoting');

    expectRejects(() => callAs(sim, bytes32(), 'commitVote'), 'You are not registered to vote.');
    expectRejects(() => callAs(sim, voter, 'commitVote', VoteChoice.TIE), 'Please provide a valid vote');
    const { ledger: l } = callAs(sim, voter, 'commitVote');
    expect(l.totalVoteCount).toBe(1n);
    expect(l.hashedVoteMap.member(voterKey(sim, voter))).toBe(true);
    expectRejects(() => callAs(sim, voter, 'commitVote'), 'Attempt to double vote');
  });

  it('runs a whole election: commit, close, reveal, declare the winner', () => {
    const [one, two, three] = [bytes32(), bytes32(), bytes32()];
    const sim = openElection([one!, two!, three!]);
    callAs(sim, one!, 'commitVote', VoteChoice.BAD);
    callAs(sim, two!, 'commitVote', VoteChoice.WORSE);
    callAs(sim, three!, 'commitVote', VoteChoice.WORSE);

    expectRejects(() => callAs(sim, one!, 'revealVote', VoteChoice.BAD), 'Voting is still open');
    expectRejects(() => callAs(sim, one!, 'closeVoting'), 'You are not the organizer');
    callAs(sim, ORGANIZER_SK, 'closeVoting');

    expectRejects(() => callAs(sim, one!, 'revealVote', VoteChoice.WORSE), 'Attempt to change the vote!');
    callAs(sim, one!, 'revealVote', VoteChoice.BAD);
    callAs(sim, two!, 'revealVote', VoteChoice.WORSE);
    callAs(sim, three!, 'revealVote', VoteChoice.WORSE);
    expectRejects(() => callAs(sim, one!, 'revealVote', VoteChoice.BAD), 'You have already revealed your vote');
    expectRejects(() => callAs(sim, bytes32(), 'revealVote'), 'You have not voted yet');

    expectRejects(() => callAs(sim, one!, 'checkWinner'), 'You are not an organizer');
    const { ledger: l } = callAs(sim, ORGANIZER_SK, 'checkWinner');
    expect(l.candidate0VoteCounter).toBe(1n);
    expect(l.candidate1VoteCounter).toBe(2n);
    expect(l.winner).toBe(VoteChoice.WORSE);
  });

  it("won't close an election nobody voted in", () => {
    const sim = openElection([bytes32()]);
    expectRejects(() => callAs(sim, ORGANIZER_SK, 'closeVoting'), "You can't close the voting with no votes");
  });

  // Issue #65: the same secret must not give the same key in two deployments.
  describe('keys bound to the deployment', () => {
    it('gives a voter who reuses a secret unrelated keys and commitments in two elections', () => {
      const voter = bytes32();
      const [a, b] = [openElection([voter]), openElection([voter])];
      callAs(a, voter, 'commitVote', VoteChoice.WORSE);
      callAs(b, voter, 'commitVote', VoteChoice.WORSE);

      const [keyA] = [...a.ledger().registeredVoters];
      const [keyB] = [...b.ledger().registeredVoters];
      expect(keyA).toEqual(voterKey(a, voter));
      expect(keyB).toEqual(voterKey(b, voter));
      expect(keyA).not.toEqual(keyB);

      // Same secret, same vote: the commitments still differ.
      const [[, commitA]] = [...a.ledger().hashedVoteMap];
      const [[, commitB]] = [...b.ledger().hashedVoteMap];
      expect(commitA).not.toEqual(commitB);
    });

    it('gives an organizer who reuses a secret unrelated keys when each nonce is fresh', () => {
      const [a, b] = [deploy(), deploy()];
      expect(a.ledger().organizer).not.toEqual(b.ledger().organizer);
      // ...and the organizer of one can't act as the organizer of the other
      // with a different secret.
      const other = deploy(bytes32(), bytes32());
      callAs(other, bytes32(), 'registerToVote');
      expectRejects(() => callAs(other, ORGANIZER_SK, 'openVoting'), 'You are not the organizer');
    });

    it('links the organizer across deployments if the deployer reuses a nonce (the accepted risk)', () => {
      // The constructor can't use kernel.self(), so the organizer key is only
      // as unique as the nonce the deployer passes. This is why the nonce must
      // be fresh: here it isn't, and the two organizer keys are identical.
      const nonce = bytes32();
      expect(deploy(nonce).ledger().organizer).toEqual(deploy(nonce).ledger().organizer);
    });
  });

  // Never on chain: any participant's secret key, or how a voter voted before
  // they reveal it.
  it('keeps every secret key out of public state', () => {
    const [one, two] = [bytes32(), bytes32()];
    const sim = openElection([one!, two!]);
    callAs(sim, one!, 'commitVote', VoteChoice.BAD);
    callAs(sim, two!, 'commitVote', VoteChoice.WORSE);
    callAs(sim, ORGANIZER_SK, 'closeVoting');
    callAs(sim, one!, 'revealVote', VoteChoice.BAD);

    assertNotInPublicState(sim.ledger(), {
      organizerSecretKey: ORGANIZER_SK,
      voterOneSecretKey: one!,
      voterTwoSecretKey: two!,
    });
  });
});
