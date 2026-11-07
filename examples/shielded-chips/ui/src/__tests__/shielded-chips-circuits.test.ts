// @vitest-environment node
//
// Runs the real compiled roulette and chips contracts in memory (no network,
// no proofs) through the Node test's round (src/test/roulette.test.ts), with
// the coins the UI builds: fresh ones (freshChip) instead of coins read from a
// wallet. Each step asserts on the ledger the panel shows, and the panel's
// pure helpers are checked against the circuits: dappPublicKey / roleOf
// against theHouse, recoverWinningNumber and colorOf against the constructor
// and revealWinningNumber, actionError against every assert it mirrors.
//
// Token movements aren't ledger state; the deposits and bets are checked on
// the call's Effects. On chain, those are what the wallet balances.
//
// Seed file: generated once by `npm run new:ui`, then yours to edit. The drift
// check ignores it.
import { afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  sampleContractAddress,
  type CircuitContext,
  type ChargedState,
  type CircuitResults,
} from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { ZswapOutput } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { Contract as ChipsContract, ledger as chipsLedger } from "../../../contract/managed/chips/contract/index.js";
import { chipsWitnesses, rememberEscrow, rouletteWitnesses } from "../../../contract/witnesses.js";
import {
  Contract,
  createInitialPrivateState,
  ledger,
  type Ledger,
  type ShieldedChipsPrivateState,
} from "../midnight/contract";
import {
  actionError,
  BetState,
  chipColor,
  claimWinnings,
  Color,
  colorOf,
  dappPublicKey,
  escrowMtIndex,
  escrowRecorded,
  forfeit,
  freshChip,
  houseClaimMatch,
  houseDeposit,
  matchKeyFor,
  newPlayerState,
  parseAmount,
  parseNumber,
  playerView,
  recoverWinningNumber,
  revealWinningNumber,
  roleOf,
  type Action,
} from "../midnight/shielded-chips-api";

type PS = ShieldedChipsPrivateState;

const COIN_PK = "00".repeat(32);
const ADDRESS = dummyContractAddress();
// The chips token would live at its own address; for the color it only has
// to be some contract address.
const COLOR = chipColor(ADDRESS);
const WINNING_NUMBER = 1n; // RED

const roulette = new Contract(rouletteWitnesses);
const r = roulette.impureCircuits;

const house = createInitialPrivateState(bytes(1));
const bob = createInitialPrivateState(bytes(2), bytes(12));
const charlie = createInitialPrivateState(bytes(3), bytes(13));

function bytes(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

async function deployTable(winningNumber = WINNING_NUMBER) {
  const { currentContractState } = await roulette.initialState(
    createConstructorContext(house, COIN_PK),
    winningNumber,
    COLOR.bytes,
  );
  return currentContractState.data;
}

/** A circuit context on `data` as `ps`. The circuit id is only a label; the circuits don't read it. */
function contextOn<T>(address: string, coinPk: string, data: ChargedState, ps: T): CircuitContext<T> {
  return createCircuitContext({
    circuitId: "inMemory",
    contractAddress: address,
    coinPublicKeyOrZswapState: coinPk,
    contractState: data,
    privateState: ps,
  });
}

/** The table between calls: its state, and a call that advances it. */
class Table {
  private constructor(public data: ChargedState) {}
  /** Deploy a fresh table. */
  static async open(winningNumber = WINNING_NUMBER): Promise<Table> {
    return new Table(await deployTable(winningNumber));
  }
  get ledger(): Ledger {
    return ledger(this.data);
  }
  /** Run a circuit as `ps`; on success the table moves to the new state. */
  async call<R>(ps: PS, fn: (ctx: CircuitContext<PS>) => Promise<CircuitResults<PS, R>>): Promise<CircuitResults<PS, R>> {
    const res = await fn(contextOn(ADDRESS, COIN_PK, this.data, ps));
    this.data = res.context.callContext.currentQueryContext.state;
    return res;
  }
  /** The circuit's error message, or null if it would succeed (state unchanged). */
  async errorOf(ps: PS, fn: (ctx: CircuitContext<PS>) => Promise<unknown>): Promise<string | null> {
    try {
      await fn(contextOn(ADDRESS, COIN_PK, this.data, ps));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}

/** A player's private state after betting `arg`, as placeBet records it. */
function afterBet(ps: PS, arg: ReturnType<typeof freshChip>["arg"], mtIndex = 7n): PS {
  return rememberEscrow(ps, { ...arg, mt_index: mtIndex });
}

/** actionError and the circuit agree: both pass, or the circuit fails with that reason. */
async function expectMirrors(
  table: Table,
  action: Action,
  ps: PS,
  run: (ctx: CircuitContext<PS>) => Promise<unknown>,
  opts = {},
) {
  const predicted = actionError(action, table.ledger, ps, opts);
  const actual = await table.errorOf(ps, run);
  if (predicted === null) expect(actual).toBeNull();
  else expect(actual).toContain(predicted);
}

describe("roulette (in memory)", () => {
  it("deploys a table: house key, chip color, committed number, betting open", async () => {
    const t = await Table.open();
    expect(toHex(t.ledger.theHouse)).toBe(toHex(dappPublicKey(house.sk)));
    expect(toHex(t.ledger.chipColor)).toBe(COLOR.hex);
    expect(t.ledger.betState).toBe(BetState.OPEN);
    expect(roleOf(t.ledger, house)).toBe("house");
    expect(roleOf(t.ledger, bob)).toBe("player");
    expect(roleOf(t.ledger, null)).toBeNull();
  });

  it("recovers every committed number from the house key alone", async () => {
    for (let n = 0n; n <= 36n; n++) {
      const l = ledger(await deployTable(n));
      expect(recoverWinningNumber(l, house.sk)).toBe(n);
      expect(recoverWinningNumber(l, bob.sk)).toBeNull();
    }
  });

  it("parseNumber accepts exactly what the constructor accepts", async () => {
    for (const n of [0n, 1n, 35n, 36n, 37n, 255n]) {
      const ok = await (async () => {
        try {
          await deployTable(n);
          return true;
        } catch {
          return false;
        }
      })();
      expect(parseNumber(n.toString()) !== null).toBe(ok);
    }
    expect(parseNumber("-1")).toBeNull();
    expect(parseNumber("x")).toBeNull();
  });

  it("plays a full round with fresh coins", async () => {
    const t = await Table.open();

    // House deposits two match coins.
    for (let i = 0; i < 2; i++) {
      const { context } = await t.call(house, (ctx) => r.houseDeposit(ctx, freshChip(COLOR.hex, 100n).arg));
      // Just the deposit: the fresh coin is stored as it is, no re-send.
      expect(context.callContext.currentQueryContext.effects.claimedShieldedReceives).toHaveLength(1);
    }
    expect(t.ledger.houseCoins.size()).toBe(2n);
    // A deposit can't reuse a pool key (it would overwrite that coin's entry).
    const poolKey = [...t.ledger.houseCoins][0]![0];
    expect(
      await t.errorOf(house, (ctx) => r.houseDeposit(ctx, { nonce: poolKey, color: COLOR.bytes, value: 1n })),
    ).toContain("already deposited");
    expect(await t.errorOf(bob, (ctx) => r.houseDeposit(ctx, freshChip(COLOR.hex, 1n).arg))).toContain(
      "Only the house can deposit",
    );
    expect(await t.errorOf(house, (ctx) => r.houseDeposit(ctx, freshChip("11".repeat(32), 1n).arg))).toContain(
      "Deposit must be made with roulette chips",
    );

    // Bob bets RED, Charlie BLACK; the house can't bet, nobody bets twice.
    const bobChip = freshChip(COLOR.hex, 100n);
    await expectMirrors(t, "bet", bob, (ctx) => r.betColor(ctx, bobChip.arg, Color.GREEN), { betColor: Color.GREEN });
    await expectMirrors(t, "bet", house, (ctx) => r.betColor(ctx, bobChip.arg, Color.RED), { betColor: Color.RED });
    await expectMirrors(t, "bet", bob, (ctx) => r.betColor(ctx, bobChip.arg, Color.RED), { betColor: Color.RED });
    const bet = await t.call(bob, (ctx) => r.betColor(ctx, bobChip.arg, Color.RED));
    expect(bet.context.callContext.currentQueryContext.effects.claimedShieldedReceives).toHaveLength(1);
    const bobAfter = afterBet(bob, bobChip.arg);
    await expectMirrors(t, "bet", bobAfter, (ctx) => r.betColor(ctx, bobChip.arg, Color.BLACK), { betColor: Color.BLACK });

    const charlieChip = freshChip(COLOR.hex, 100n);
    await t.call(charlie, (ctx) => r.betColor(ctx, charlieChip.arg, Color.BLACK));
    const charlieAfter = afterBet(charlie, charlieChip.arg);

    // The bet size is public; the coin isn't (a salted commitment).
    expect(playerView(t.ledger, bobAfter)).toMatchObject({ bet: Color.RED, escrowValue: 100n, paid: false });
    for (const [, commit] of t.ledger.betCommits) expect(toHex(commit)).not.toContain(toHex(bobChip.arg.nonce));

    // Nothing to claim or forfeit before the reveal.
    await expectMirrors(t, "claim", bobAfter, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n)!));
    await expectMirrors(t, "forfeit", charlieAfter, (ctx) => r.forfeit(ctx));

    // Only the house reveals, and only its committed number.
    expect(await t.errorOf(bob, (ctx) => r.revealWinningNumber(ctx, WINNING_NUMBER))).toContain("Only the House");
    expect(await t.errorOf(house, (ctx) => r.revealWinningNumber(ctx, 3n))).toContain("Cheat Detected");
    const revealed = recoverWinningNumber(t.ledger, house.sk)!;
    await t.call(house, (ctx) => r.revealWinningNumber(ctx, revealed));
    expect(t.ledger.betState).toBe(BetState.CLOSED);
    expect(t.ledger.winningColor).toBe(colorOf(WINNING_NUMBER));
    await expectMirrors(t, "bet", createInitialPrivateState(bytes(9), bytes(19)), (ctx) => r.betColor(ctx, bobChip.arg, Color.RED), { betColor: Color.RED });

    // Wrong side of each outcome.
    await expectMirrors(t, "forfeit", bobAfter, (ctx) => r.forfeit(ctx));
    await expectMirrors(t, "claim", charlieAfter, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n)!));
    // A browser without the escrowed coin can't reopen the commitment.
    expect(actionError("claim", t.ledger, bob, { escrowRecorded: escrowRecorded(bob) })).toContain("no record");
    expect(await t.errorOf(bob, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n)!))).toContain(
      "Escrowed coin does not match",
    );

    // Bob claims 2x: escrow merged with one match coin.
    await expectMirrors(t, "claim", bobAfter, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n)!));
    await t.call(bobAfter, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n)!));
    expect(playerView(t.ledger, bobAfter)).toMatchObject({ paid: true, escrowValue: null });
    expect(t.ledger.houseCoins.size()).toBe(1n);
    await expectMirrors(t, "claim", bobAfter, (ctx) => r.claimWinnings(ctx, matchKeyFor(t.ledger, 100n) ?? bytes(0)));

    // Charlie forfeits into the pool; then there's nothing left to forfeit.
    await expectMirrors(t, "forfeit", charlieAfter, (ctx) => r.forfeit(ctx));
    await t.call(charlieAfter, (ctx) => r.forfeit(ctx));
    expect(t.ledger.houseCoins.size()).toBe(2n);
    await expectMirrors(t, "forfeit", charlieAfter, (ctx) => r.forfeit(ctx));

    // The house sweeps the pool; players can't.
    const [first] = [...t.ledger.houseCoins][0]!;
    expect(await t.errorOf(bobAfter, (ctx) => r.houseClaimMatch(ctx, first))).toContain("Only the house can sweep");
    for (const [key] of [...t.ledger.houseCoins]) await t.call(house, (ctx) => r.houseClaimMatch(ctx, key));
    expect(t.ledger.houseCoins.isEmpty()).toBe(true);
  });

  it("finds no match coin for a winner when the pool has none of that value", async () => {
    const t = await Table.open();
    await t.call(house, (ctx) => r.houseDeposit(ctx, freshChip(COLOR.hex, 50n).arg));
    const chip = freshChip(COLOR.hex, 100n);
    await t.call(bob, (ctx) => r.betColor(ctx, chip.arg, Color.RED));
    await t.call(house, (ctx) => r.revealWinningNumber(ctx, WINNING_NUMBER));
    expect(matchKeyFor(t.ledger, 100n)).toBeNull();
    expect(actionError("claim", t.ledger, afterBet(bob, chip.arg))).toBe("Match coin not available");
  });

  it("GREEN (0): nobody wins, every player forfeits", async () => {
    const t = await Table.open(0n);
    const chip = freshChip(COLOR.hex, 10n);
    await t.call(bob, (ctx) => r.betColor(ctx, chip.arg, Color.RED));
    await t.call(house, (ctx) => r.revealWinningNumber(ctx, 0n));
    expect(t.ledger.winningColor).toBe(Color.GREEN);
    const ps = afterBet(bob, chip.arg);
    await expectMirrors(t, "claim", ps, (ctx) => r.claimWinnings(ctx, bytes(0)));
    await expectMirrors(t, "forfeit", ps, (ctx) => r.forfeit(ctx));
  });

  it("new players get a random key and salt, never the all-zero default", () => {
    const a = newPlayerState();
    const b = newPlayerState();
    expect(toHex(a.sk)).not.toBe(toHex(b.sk));
    expect(a.escrowSalt.some((x) => x !== 0)).toBe(true);
    expect(escrowRecorded(a)).toBe(false);
  });
});

describe("chips token (in memory)", () => {
  // The chips circuits refuse the zero address as a mint target (the treasury
  // is kernel.self()) and as a refund target (ownPublicKey()), so this
  // contract gets a real-looking address and coin key.
  const CHIPS_ADDRESS = sampleContractAddress();
  const CHIPS_COLOR = chipColor(CHIPS_ADDRESS);
  const HOUSE_PK = "11".repeat(32);
  const chips = new ChipsContract(chipsWitnesses);
  const c = chips.impureCircuits;
  const DOMAIN = new Uint8Array(32);
  DOMAIN.set(new TextEncoder().encode("roulette:chip:"));
  let deployed: ChargedState;
  beforeAll(async () => {
    const { currentContractState } = await chips.initialState(
      createConstructorContext(house, HOUSE_PK),
      "Roulette Chips",
      "CHIP",
      0n,
      DOMAIN,
    );
    deployed = currentContractState.data;
  });
  const ctx = (ps: PS, data = deployed) => contextOn(CHIPS_ADDRESS, HOUSE_PK, data, ps);

  it("mints coins of the color chipColor computes, house only", async () => {
    const res = await c.mint(ctx(house), { bytes: bytes(5) }, 100n, bytes(6));
    expect(toHex(res.result.color)).toBe(CHIPS_COLOR.hex);
    expect(res.result.value).toBe(100n);
    expect(chipsLedger(res.context.callContext.currentQueryContext.state)._totalMinted).toBe(100n);
    await expect(c.mint(ctx(bob), { bytes: bytes(5) }, 100n, bytes(6))).rejects.toThrow(/Only the house/);
  });

  it("burns a fresh coin of exactly the amount, with no refund", async () => {
    const res = await c.burn(ctx(house), freshChip(CHIPS_COLOR.hex, 40n).arg, 40n);
    expect(res.result.is_some).toBe(false);
    expect(chipsLedger(res.context.callContext.currentQueryContext.state)._totalBurned).toBe(40n);
  });

  it("mints to and burns from the treasury", async () => {
    const minted = await c.mintToTreasury(ctx(house), 60n, bytes(7));
    const data = minted.context.callContext.currentQueryContext.state;
    const [key] = [...chipsLedger(data)._treasury][0]!;
    const burned = await c.burnFromTreasury(ctx(house, data), key, 25n);
    const l = chipsLedger(burned.context.callContext.currentQueryContext.state);
    expect(l._totalBurned).toBe(25n);
    expect([...l._treasury].map(([, coin]) => coin.value)).toEqual([35n]);
  });
});

describe("escrowMtIndex", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds the escrow output's position to the tx's zswapStartIndex", async () => {
    const { coin } = freshChip(COLOR.hex, 100n);
    const escrow = ZswapOutput.newContractOwned(coin, 0, ADDRESS).commitment;
    const fetchMock = vi.fn(async () => Response.json({ data: { transactions: [{ zswapStartIndex: 36 }] } }));
    vi.stubGlobal("fetch", fetchMock);
    // A change output first, then the escrow: what the devnet showed for a
    // 100-chip bet paid from a 150-chip coin.
    const tx = { txId: "00ab", outputs: [{ commitment: "change" }, { commitment: escrow }] };

    await expect(escrowMtIndex("http://indexer/graphql", tx, coin, ADDRESS)).resolves.toBe(37n);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.variables).toEqual({ id: "00ab" });
  });

  it("refuses a tx without the escrow output", async () => {
    const { coin } = freshChip(COLOR.hex, 100n);
    const tx = { txId: "00", outputs: [] };
    await expect(escrowMtIndex("http://indexer/graphql", tx, coin, ADDRESS)).rejects.toThrow(/no output/);
  });
});

describe("parseAmount", () => {
  it("accepts positive whole numbers that fit a Uint<64>", () => {
    expect(parseAmount("100")).toBe(100n);
    expect(parseAmount(" 7 ")).toBe(7n);
    expect(parseAmount((2n ** 64n - 1n).toString())).toBe(2n ** 64n - 1n);
    for (const bad of ["0", "-1", "1.5", "", "abc", (2n ** 64n).toString()]) expect(parseAmount(bad)).toBeNull();
  });
});

// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each roulette wrapper must hit the callTx overload that proves,
// submits and waits for finalization.
describe("roulette circuit wrappers (types)", () => {
  it("submit through callTx", () => {
    expectTypeOf<Awaited<ReturnType<typeof houseDeposit>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "houseDeposit">
    >();
    expectTypeOf<Awaited<ReturnType<typeof revealWinningNumber>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "revealWinningNumber">
    >();
    expectTypeOf<Awaited<ReturnType<typeof claimWinnings>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "claimWinnings">
    >();
    expectTypeOf<Awaited<ReturnType<typeof forfeit>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "forfeit">
    >();
    expectTypeOf<Awaited<ReturnType<typeof houseClaimMatch>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "houseClaimMatch">
    >();
  });
});
