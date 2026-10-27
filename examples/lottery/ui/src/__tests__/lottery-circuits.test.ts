// @vitest-environment node
//
// Runs the real compiled lottery contract in memory (no network, no proofs)
// with one secret per person. It replays the Node test's lottery
// (src/test/lottery.test.ts), and at every step checks, for every person and
// every circuit, that the panel's pre-check (actionError) predicts exactly
// what the circuit accepts. It also checks that lotteryView finds each
// person's own tickets and the winner through the contract's pure circuits.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  type ChargedState,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { witnesses } from "../../../contract/witnesses.js";
import { Contract, createInitialPrivateState, ledger, type Ledger } from "../midnight/contract";
import {
  actionError,
  buyTicket,
  claimPrize,
  closeSales,
  deployInputError,
  draw,
  LotteryState,
  lotteryView,
  randomNonce,
  type LotteryCircuit,
} from "../midnight/lottery-api";

// The coin key only matters to Zswap; people are identified by their secret.
const COIN_PK = "00".repeat(32);
const ADDRESS = dummyContractAddress();
const contract = new Contract(witnesses);
const CIRCUITS: LotteryCircuit[] = ["buyTicket", "closeSales", "draw", "claimPrize"];

interface Person {
  name: string;
  secretKey: Uint8Array;
  seed: Uint8Array;
}
const person = (name: string, n: number): Person => ({
  name,
  secretKey: new Uint8Array(32).fill(n),
  seed: new Uint8Array(32).fill(n + 100),
});
const organizer = person("organizer", 1);
const one = person("player one", 2);
const two = person("player two", 3);
const watcher = person("watcher", 4); // never buys
const everyone = [organizer, one, two, watcher];

function deploy(price: bigint, max: bigint): ChargedState {
  const ps = createInitialPrivateState(organizer.secretKey, organizer.seed);
  return contract.initialState(createConstructorContext(ps, COIN_PK), price, max).currentContractState.data;
}

/** Run `circuit` as `who`, with the args the panel passes; throws when the contract rejects. */
function call(state: ChargedState, circuit: LotteryCircuit, who: Person): ChargedState {
  const ctx = createCircuitContext(ADDRESS, COIN_PK, state, createInitialPrivateState(who.secretKey, who.seed));
  const c = contract.impureCircuits;
  const { context } =
    circuit === "buyTicket"
      ? c.buyTicket(ctx, randomNonce())
      : circuit === "claimPrize"
        ? c.claimPrize(ctx, { bytes: new Uint8Array(32).fill(9) })
        : c[circuit](ctx);
  return context.currentQueryContext.state;
}

/** For every person and circuit: actionError says "ok" exactly when the circuit runs. */
function expectPreChecksAgree(state: ChargedState) {
  const l = ledger(state);
  for (const who of everyone) {
    const view = lotteryView(l, ADDRESS, who.secretKey);
    for (const circuit of CIRCUITS) {
      const predicted = actionError(circuit, l, view);
      let accepted: boolean;
      try {
        call(state, circuit, who);
        accepted = true;
      } catch {
        accepted = false;
      }
      expect({ who: who.name, circuit, accepted }).toEqual({ who: who.name, circuit, accepted: predicted === null });
    }
  }
}

describe("lottery contract (in memory)", () => {
  it("replays the Node test's lottery; the panel's pre-checks agree at every step", () => {
    // Same price and cap as the Node test.
    let state = deploy(1_000n, 3n);
    let l: Ledger = ledger(state);
    expect(l.state).toBe(LotteryState.OPEN);
    expect(l.ticketPrice).toBe(1_000n);
    expect(lotteryView(l, ADDRESS, organizer.secretKey).role).toBe("organizer");
    expect(lotteryView(l, ADDRESS, one.secretKey).role).toBe("player");
    expectPreChecksAgree(state);

    // Each player buys a ticket; lotteryView finds each one's own.
    state = call(state, "buyTicket", one);
    state = call(state, "buyTicket", two);
    l = ledger(state);
    expect(l.pot).toBe(2_000n);
    expect(lotteryView(l, ADDRESS, one.secretKey).myTickets).toEqual([0n]);
    expect(lotteryView(l, ADDRESS, two.secretKey).myTickets).toEqual([1n]);
    expect(lotteryView(l, ADDRESS, watcher.secretKey).myTickets).toEqual([]);
    expectPreChecksAgree(state);

    state = call(state, "closeSales", organizer);
    expect(ledger(state).state).toBe(LotteryState.CLOSED);
    expectPreChecksAgree(state);

    state = call(state, "draw", organizer);
    l = ledger(state);
    expect(l.state).toBe(LotteryState.DRAWN);
    const winner = l.winningTicket === 0n ? one : two;
    const loser = winner === one ? two : one;
    expect(lotteryView(l, ADDRESS, winner.secretKey).won).toBe(true);
    expect(lotteryView(l, ADDRESS, loser.secretKey).won).toBe(false);
    expectPreChecksAgree(state);

    state = call(state, "claimPrize", winner);
    l = ledger(state);
    expect(l.state).toBe(LotteryState.PAID);
    expect(l.pot).toBe(0n);
    expectPreChecksAgree(state);
  });

  it("sells out: a full lottery takes no more tickets", () => {
    let state = deploy(5n, 2n);
    state = call(state, "buyTicket", one);
    state = call(state, "buyTicket", one);
    const l = ledger(state);
    expect(lotteryView(l, ADDRESS, one.secretKey).myTickets).toEqual([0n, 1n]);
    expectPreChecksAgree(state);
  });

  it("a player's draw from another browser is refused: only the organizer's secret and seed work", () => {
    let state = deploy(5n, 2n);
    state = call(state, "buyTicket", one);
    state = call(state, "closeSales", organizer);
    // The organizer's key with a different seed, as from a second browser.
    expect(() => call(state, "draw", { ...organizer, seed: new Uint8Array(32) })).toThrow(
      "Seed does not match the commitment",
    );
  });

  it("deployInputError matches the constructor on an edge grid", () => {
    for (const price of [0n, 1n, 2n ** 64n - 1n]) {
      for (const max of [0n, 1n, 2n, 65535n]) {
        let accepted = true;
        try {
          deploy(price, max);
        } catch {
          accepted = false;
        }
        expect({ price, max, accepted }).toEqual({ price, max, accepted: deployInputError({ price, maxTickets: max }) === null });
      }
    }
  });
});

// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each wrapper must hit the callTx overload that proves, submits and
// waits for finalization, and take exactly the circuit's arguments (counted
// from contract-info.json) after the contract handle.
describe("lottery circuit wrappers (types)", () => {
  it("submit through callTx with exactly the circuit's arguments", () => {
    expectTypeOf<Awaited<ReturnType<typeof buyTicket>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "buyTicket">
    >();
    expectTypeOf<Parameters<typeof buyTicket>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof closeSales>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "closeSales">
    >();
    expectTypeOf<Parameters<typeof closeSales>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Awaited<ReturnType<typeof draw>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "draw">
    >();
    expectTypeOf<Parameters<typeof draw>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Awaited<ReturnType<typeof claimPrize>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "claimPrize">
    >();
    expectTypeOf<Parameters<typeof claimPrize>["length"]>().toEqualTypeOf<2>();
  });
});
