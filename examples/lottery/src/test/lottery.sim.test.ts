// This file is part of example-lottery.
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
// network and no proofs. `yarn compile:fast && yarn test:sim` runs them in
// seconds; put contract logic, every guard and the privacy invariants here,
// and keep the devnet suite (lottery.test.ts) for the end-to-end flow.
// `yarn new:example lottery --derive` (repo root) fills the @generated-stub
// regions from the compiled contract; once you edit a region it is left alone.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from '@midnight-ntwrk/example-sim';
import { Contract, LotteryState, ledger, pureCircuits, type Witnesses } from '../../contract/managed/lottery/contract/index.js';
// @generated-stub begin coin-imports sha=e3b0c44298fc
// @generated-stub end coin-imports
import { type LotteryPrivateState, createLotteryPrivateState, witnesses } from '../../contract/witnesses.js';

const bytes32 = () => new Uint8Array(randomBytes(32));

const ORGANIZER_SK = bytes32();
const SEED = bytes32();
const PRICE = 10n;
const MAX = 3n;

const deploy = (
  max = MAX,
  w: Witnesses<LotteryPrivateState> = witnesses,
  seed = SEED,
) =>
  Sim.deploy({
    contract: new Contract(w),
    ledger,
    // @generated-stub begin private-state sha=f9d2b36842cc
    privateState: createLotteryPrivateState(ORGANIZER_SK, seed),
    // @generated-stub end private-state
    // @generated-stub begin constructor-args sha=e5de2a461255
    args: [
      PRICE, // price: Uint<64>
      max, // max: Uint<16>
    ],
    // @generated-stub end constructor-args
  });

type Lottery = ReturnType<typeof deploy>;

// Swap in a caller. A fresh seed shows that a player's seed is never used.
const as = (sim: Lottery, sk: Uint8Array, seed = bytes32()) => {
  sim.privateState = createLotteryPrivateState(sk, seed);
  return sim;
};
const organizer = (sim: Lottery) => as(sim, ORGANIZER_SK, SEED);

// Players buy one ticket each, in order. Returns the nonces they used.
const sell = (sim: Lottery, players: Uint8Array[]) =>
  players.map((sk) => {
    const nonce = bytes32();
    as(sim, sk).call('buyTicket', nonce);
    return nonce;
  });

// Sells a ticket to each player, closes and draws. Returns the winner's secret.
const runDraw = (sim: Lottery, players: Uint8Array[]) => {
  sell(sim, players);
  organizer(sim).call('closeSales');
  const l = organizer(sim).call('draw').ledger;
  return players[Number(l.winningTicket)]!;
};

const address = () => ({ bytes: bytes32() });

// Everything above is generated boilerplate. Your tests begin here.
//
//   sim.call('circuit', ...args)        one transaction; returns { result, ledger }
//   sim.as(coinPublicKeyHex)            later calls come from another wallet
//   sim.privateState = ...              swap the private state (another user)
//   expectRejects(() => sim.call(...), 'assert message')   every guard

describe('Lottery (in memory)', () => {
  it('deploys open, with the rules sealed and an empty pot', () => {
    const l = deploy().ledger();
    expect(l.state).toBe(LotteryState.OPEN);
    expect(l.ticketPrice).toBe(PRICE);
    expect(l.maxTickets).toBe(MAX);
    expect(l.ticketCount).toBe(0n);
    expect(l.pot).toBe(0n);
    expect(l.tickets.isEmpty()).toBe(true);
  });

  it('rejects a free ticket or a lottery with fewer than two tickets', () => {
    expectRejects(
      () => Sim.deploy({ contract: new Contract(witnesses), ledger, privateState: createLotteryPrivateState(), args: [0n, MAX] }),
      'Ticket price must be positive',
    );
    expectRejects(() => deploy(1n), 'A lottery needs at least two tickets');
  });

  // @generated-stub begin circuits sha=f9b06a4313ed
  it('buyTicket: records each ticket under the player key, mixes its nonce into entropy and grows the pot', () => {
    const sim = deploy();
    const alice = bytes32();
    const start = sim.ledger().entropy;

    as(sim, alice).call('buyTicket', bytes32());
    const afterOne = sim.ledger();
    expect(afterOne.ticketCount).toBe(1n);
    expect(afterOne.pot).toBe(PRICE);
    expect(afterOne.entropy).not.toEqual(start);

    // A second ticket for the same player gets the same key and a new number.
    as(sim, alice).call('buyTicket', bytes32());
    const l = sim.ledger();
    expect(l.ticketCount).toBe(2n);
    expect(l.pot).toBe(2n * PRICE);
    expect(l.tickets.lookup(1n)).toEqual(l.tickets.lookup(0n));
    expect(l.entropy).not.toEqual(afterOne.entropy);
  });

  it('organizerKey and playerKey: clients can recompute the keys the contract stores', () => {
    const sim = deploy();
    const alice = bytes32();
    sell(sim, [alice]);
    const l = sim.ledger();
    expect(l.organizer).toEqual(pureCircuits.organizerKey(ORGANIZER_SK));
    expect(l.tickets.lookup(0n)).toEqual(pureCircuits.playerKey(Buffer.from(sim.address, 'hex'), alice));
    // The same secret gives a different player key in another lottery.
    expect(pureCircuits.playerKey(bytes32(), alice)).not.toEqual(l.tickets.lookup(0n));
  });

  it('buyTicket: different players get different keys, none of them the organizer key', () => {
    const sim = deploy();
    sell(sim, [bytes32(), bytes32()]);
    const l = sim.ledger();
    expect(l.tickets.lookup(0n)).not.toEqual(l.tickets.lookup(1n));
    expect(l.tickets.lookup(0n)).not.toEqual(l.organizer);
  });

  it('buyTicket: rejects the organizer, a sold-out lottery and closed sales', () => {
    const sim = deploy(2n);
    expectRejects(() => organizer(sim).call('buyTicket', bytes32()), 'The organizer cannot buy tickets');
    // The organizer's secret is caught even with another seed.
    expectRejects(() => as(sim, ORGANIZER_SK).call('buyTicket', bytes32()), 'The organizer cannot buy tickets');

    sell(sim, [bytes32(), bytes32()]);
    expectRejects(() => as(sim, bytes32()).call('buyTicket', bytes32()), 'All tickets are sold');

    organizer(sim).call('closeSales');
    expectRejects(() => as(sim, bytes32()).call('buyTicket', bytes32()), 'Ticket sales are closed');
    expect(sim.ledger().ticketCount).toBe(2n);
  });

  it('closeSales: only the organizer, only while open, only after a sale', () => {
    const sim = deploy();
    expectRejects(() => organizer(sim).call('closeSales'), 'No tickets were sold');
    sell(sim, [bytes32()]);
    expectRejects(() => as(sim, bytes32()).call('closeSales'), 'Only the organizer can close sales');

    expect(organizer(sim).call('closeSales').ledger.state).toBe(LotteryState.CLOSED);
    expectRejects(() => organizer(sim).call('closeSales'), 'Ticket sales are closed');
  });

  it('draw: picks a sold ticket and records its holder', () => {
    const sim = deploy();
    const players = [bytes32(), bytes32(), bytes32()];
    runDraw(sim, players);
    const l = sim.ledger();
    expect(l.state).toBe(LotteryState.DRAWN);
    expect(l.winningTicket).toBeLessThan(3n);
    expect(l.winner).toEqual(l.tickets.lookup(l.winningTicket));
  });

  it('draw: every ticket can win', () => {
    // 3 tickets, 40 lotteries with fresh seeds: each ticket is missed with
    // probability (2/3)^40, about 1e-7.
    const wins = new Set<bigint>();
    for (let i = 0; i < 40; i++) {
      const seed = bytes32();
      const sim = deploy(MAX, witnesses, seed);
      sell(sim, [bytes32(), bytes32(), bytes32()]);
      as(sim, ORGANIZER_SK, seed).call('closeSales');
      wins.add(as(sim, ORGANIZER_SK, seed).call('draw').ledger.winningTicket);
    }
    expect([...wins].sort()).toEqual([0n, 1n, 2n]);
  });

  it('draw: only the organizer, only after sales close, only once', () => {
    const sim = deploy();
    sell(sim, [bytes32()]);
    expectRejects(() => organizer(sim).call('draw'), 'Sales must be closed before the draw');
    organizer(sim).call('closeSales');
    expectRejects(() => as(sim, bytes32()).call('draw'), 'Only the organizer can draw');
    organizer(sim).call('draw');
    expectRejects(() => organizer(sim).call('draw'), 'Sales must be closed before the draw');
  });

  it('draw: rejects a seed other than the committed one', () => {
    const sim = deploy();
    sell(sim, [bytes32()]);
    organizer(sim).call('closeSales');
    // The organizer's key, a different seed: trying to re-roll the draw.
    expectRejects(() => as(sim, ORGANIZER_SK, bytes32()).call('draw'), 'Seed does not match the commitment');
  });

  it('draw: rejects a divMod witness that lies about the remainder', () => {
    // q - 1 and r + divisor still satisfy q * divisor + r == value, so only
    // the r < divisor check stops this witness choosing another ticket.
    const liar: Witnesses<LotteryPrivateState> = {
      ...witnesses,
      divMod: ({ privateState }, value, divisor) => [privateState, [value / divisor - 1n, (value % divisor) + divisor]],
    };
    const sim = deploy(MAX, liar);
    sell(sim, [bytes32(), bytes32()]);
    organizer(sim).call('closeSales');
    expectRejects(() => organizer(sim).call('draw'), 'Incorrect division');

    // And one that breaks the equation instead.
    const wrong: Witnesses<LotteryPrivateState> = {
      ...witnesses,
      divMod: ({ privateState }) => [privateState, [0n, 0n]],
    };
    const sim2 = deploy(MAX, wrong);
    sell(sim2, [bytes32(), bytes32()]);
    organizer(sim2).call('closeSales');
    expectRejects(() => organizer(sim2).call('draw'), 'Incorrect division');
  });

  it('claimPrize: pays the winner once and empties the pot', () => {
    const sim = deploy();
    const players = [bytes32(), bytes32(), bytes32()];
    const winner = runDraw(sim, players);
    const loser = players.find((p) => p !== winner)!;

    expectRejects(() => as(sim, loser).call('claimPrize', address()), 'Only the winner can claim');
    expectRejects(() => organizer(sim).call('claimPrize', address()), 'Only the winner can claim');

    const l = as(sim, winner).call('claimPrize', address()).ledger;
    expect(l.state).toBe(LotteryState.PAID);
    expect(l.pot).toBe(0n);
    expectRejects(() => as(sim, winner).call('claimPrize', address()), 'The draw has not happened');
  });

  it('claimPrize: not before the draw', () => {
    const sim = deploy();
    const alice = bytes32();
    sell(sim, [alice]);
    expectRejects(() => as(sim, alice).call('claimPrize', address()), 'The draw has not happened');
  });
  // @generated-stub end circuits

  // @generated-stub begin privacy sha=8073da2101d1
  // SPEC.md → Privacy invariants: one entry per "never on chain" line.
  it('keeps secrets out of public state', () => {
    const sim = deploy();
    const players = [bytes32(), bytes32()];
    const nonces = sell(sim, players);
    organizer(sim).call('closeSales');
    organizer(sim).call('draw');
    // Checked after the draw: the seed was used in-circuit and must still be
    // nowhere in public state.
    const l = sim.ledger();
    expect(Object.keys(l).sort()).toEqual(['entropy', 'maxTickets', 'organizer', 'pot', 'seedCommitment', 'state', 'ticketCount', 'ticketPrice', 'tickets', 'winner', 'winningTicket']);
    assertNotInPublicState(l, {
      organizerSecretKey: ORGANIZER_SK,
      seed: SEED,
      playerSecretKey0: players[0]!,
      playerSecretKey1: players[1]!,
      ticketNonce0: nonces[0]!,
      ticketNonce1: nonces[1]!,
    });
  });
  // @generated-stub end privacy
});
