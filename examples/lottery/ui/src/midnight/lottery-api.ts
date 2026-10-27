// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/lottery/src/test/lottery.test.ts); the only
// difference is where `providers` came from.
//
// This browser's private state (encrypted, see contract.ts's
// PRIVATE_STATE_STORAGE) holds its secret key and, for the organizer, the draw
// seed. The witnesses read both, so no circuit takes a secret as an argument.
// buyTicket's nonce is drawn fresh in code for every ticket.
//
// On top of the generated wrappers, this file holds the lottery rules the
// panel needs, derived only from the public ledger, this browser's secret and
// the contract address: who this browser is and which tickets are its own
// (lotteryView), and whether each circuit would accept the call right now
// (actionError). The circuits test runs them against the real compiled
// contract so they can't drift from its asserts.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { map, type Observable } from "rxjs";
import {
  CompiledLotteryContract,
  createInitialPrivateState,
  type LotteryPrivateState,
  PRIVATE_STATE_ID,
  type Contract,
  ledger,
  type Ledger,
  pureCircuits,
} from "./contract";
import { LotteryState } from "../../../contract/managed/lottery/contract/index.js";
import { randomNonce } from "../../../contract/witnesses.js";
import type { LotteryProviders } from "./providers";

export { LotteryState };

export type LotteryContract = FoundContract<Contract>;

/** The contract constructor's arguments (everything after the context). */
export type ConstructorArgs =
  Parameters<Contract["initialState"]> extends [unknown, ...infer A] ? A : never;

/** What the organizer chooses when deploying (the constructor's public args). */
export interface LotteryDeployInput {
  /** Ticket price in STAR (1 NIGHT = 1,000,000 STAR). `Uint<64>`. */
  price: bigint;
  /** How many tickets can be sold. `Uint<16>`. */
  maxTickets: bigint;
  /** When ticket sales end, in Unix seconds. `Uint<64>`. */
  salesEnd: bigint;
}

export const UINT16_MAX = 65535n;
export const UINT64_MAX = 2n ** 64n - 1n;

/** The current time in Unix seconds, the unit `salesEnd` is in. */
export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * The constructor's asserts (and the Uint casts), as a readable reason. The
 * contract accepts a `salesEnd` in the past (nobody could buy a ticket), so
 * that check is the UI's own.
 */
export function deployInputError(input: LotteryDeployInput, now: bigint = nowSeconds()): string | null {
  if (input.price <= 0n) return "The ticket price must be greater than zero.";
  if (input.price > UINT64_MAX) return "The ticket price is too large.";
  if (input.maxTickets < 2n) return "A lottery needs at least two tickets.";
  if (input.maxTickets > UINT16_MAX) return `At most ${UINT16_MAX} tickets.`;
  if (input.salesEnd <= now) return "The end of sales must be in the future.";
  if (input.salesEnd > UINT64_MAX) return "The end of sales is too far away.";
  return null;
}

/**
 * Deploy a fresh lottery as its organizer. A new private state is made here:
 * its secret key becomes the organizer key and its seed is committed to by the
 * constructor. Both stay in this browser, and the draw needs the seed, so the
 * organizer must deploy and draw from the same browser profile.
 */
export async function deployLottery(
  providers: LotteryProviders,
  input: LotteryDeployInput,
): Promise<{ contract: LotteryContract; address: ContractAddress }> {
  const args: ConstructorArgs = [input.price, input.maxTickets, input.salesEnd];
  const deployed = await deployContract(providers, {
    compiledContract: CompiledLotteryContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(),
    args,
  });
  return {
    contract: deployed,
    address: deployed.deployTxData.public.contractAddress,
  };
}

/**
 * Attach to an existing deployment by address. findDeployedContract fetches
 * the on-chain state and checks that its verifier keys match the ones we serve
 * (a wrong address or a different contract fails here, before any tx).
 *
 * Private state: findDeployedContract *overwrites* whatever is stored under
 * PRIVATE_STATE_ID whenever it is given an `initialPrivateState`. So reuse the
 * stored state when there is one (a reload, or the organizer coming back to
 * draw) and only fall back to a fresh one otherwise (a new player).
 */
export async function joinLottery(
  providers: LotteryProviders,
  address: ContractAddress,
  initialPrivateState: () => LotteryPrivateState = () => createInitialPrivateState(),
): Promise<LotteryContract> {
  providers.privateStateProvider.setContractAddress(address);
  const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (stored !== null) {
    return findDeployedContract(providers, {
      compiledContract: CompiledLotteryContract,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
    });
  }
  return findDeployedContract(providers, {
    compiledContract: CompiledLotteryContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: initialPrivateState(),
  });
}

/** This browser's private state for a lottery, or null if it has none yet. */
export async function readPrivateState(
  providers: LotteryProviders,
  address: ContractAddress,
): Promise<LotteryPrivateState | null> {
  providers.privateStateProvider.setContractAddress(address);
  return providers.privateStateProvider.get(PRIVATE_STATE_ID);
}

// One wrapper per provable circuit. midnight-js runs the circuit locally,
// proves it (wallet or proof server), then gets the wallet to balance and
// submit it. Each resolves once the tx is final on chain.

/**
 * A circuit's arguments without its leading CircuitContext, i.e. what
 * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx
 * members are overloaded, and `Parameters` picks the last overload, whose
 * first parameter is a TransactionContext.
 */
export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =
  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;

/**
 * Circuit `buyTicket(nonce)`: the wallet pays the ticket price in NIGHT. The
 * nonce defaults to fresh random bytes, which is what the panel uses; reusing
 * one adds no entropy to the draw.
 */
export async function buyTicket(
  contract: LotteryContract,
  ...args: CircuitArgs<"buyTicket">
) {
  return contract.callTx.buyTicket(...args);
}

/** A fresh random nonce for buyTicket. */
export { randomNonce };

/** Circuit `closeSales()`. */
export async function closeSales(
  contract: LotteryContract,
  ...args: CircuitArgs<"closeSales">
) {
  return contract.callTx.closeSales(...args);
}

/** Circuit `draw()`. */
export async function draw(
  contract: LotteryContract,
  ...args: CircuitArgs<"draw">
) {
  return contract.callTx.draw(...args);
}

/** Circuit `claimPrize(to)`: the whole pot goes to `to` (the panel passes the wallet's own address). */
export async function claimPrize(
  contract: LotteryContract,
  ...args: CircuitArgs<"claimPrize">
) {
  return contract.callTx.claimPrize(...args);
}

/**
 * Live view of the public ledger. The indexer pushes each new contract state
 * over its websocket, and the compiler-generated `ledger()` decodes it.
 */
export function ledger$(
  providers: LotteryProviders,
  address: ContractAddress,
): Observable<Ledger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data)));
}

// The lottery rules the panel needs. The two key derivations are the
// contract's own `export pure circuit`s, so they can't drift from it.

/** Byte-wise equality for keys read from the ledger. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A contract address (hex) as the `Bytes<32>` the contract hashes in. */
export function addressBytes(address: ContractAddress): Uint8Array {
  return Uint8Array.from(address.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export interface LotteryView {
  role: "organizer" | "player";
  /** The ticket numbers held under this browser's player key, in order. */
  myTickets: bigint[];
  /** The draw happened and one of `myTickets` won. */
  won: boolean;
}

export function lotteryView(state: Ledger, address: ContractAddress, secretKey: Uint8Array): LotteryView {
  const me = pureCircuits.playerKey(addressBytes(address), secretKey);
  const myTickets = [...state.tickets]
    .filter(([, holder]) => sameBytes(holder, me))
    .map(([n]) => n)
    .sort((a, b) => (a < b ? -1 : 1));
  const drawn = state.state === LotteryState.DRAWN || state.state === LotteryState.PAID;
  return {
    role: sameBytes(pureCircuits.organizerKey(secretKey), state.organizer) ? "organizer" : "player",
    myTickets,
    won: drawn && sameBytes(state.winner, me),
  };
}

export type LotteryCircuit = "buyTicket" | "closeSales" | "draw" | "claimPrize";

/**
 * Why `circuit` would reject this call right now, or null if it would run.
 * Mirrors each circuit's asserts in order, reworded; the contract still has
 * the final say (and its raw message if this ever drifts). `draw` also needs
 * the seed this browser committed to, which only the deploying browser has.
 *
 * `now` stands in for the block time. The chain checks the time when the
 * transaction lands, so a call made in the last seconds before `salesEnd`
 * can still be rejected.
 */
export function actionError(
  circuit: LotteryCircuit,
  state: Ledger,
  view: LotteryView,
  now: bigint = nowSeconds(),
): string | null {
  const s = state.state;
  const organizer = view.role === "organizer";
  const soldOut = state.ticketCount >= state.maxTickets;
  switch (circuit) {
    case "buyTicket":
      if (s !== LotteryState.OPEN) return "Ticket sales are closed.";
      if (now >= state.salesEnd) return "Ticket sales have ended.";
      if (organizer) return "The organizer can't buy tickets.";
      if (soldOut) return "All tickets are sold.";
      return null;
    case "closeSales":
      if (s !== LotteryState.OPEN) return "Sales are already closed.";
      if (now < state.salesEnd && !soldOut) return "Sales are still open: they close when time is up or every ticket is sold.";
      if (state.ticketCount === 0n) return "No tickets were sold.";
      return null;
    case "draw":
      if (!organizer) return "Only the organizer can draw.";
      if (s !== LotteryState.CLOSED) return "The draw happens once sales are closed, and only once.";
      return null;
    case "claimPrize":
      if (s !== LotteryState.DRAWN) return s === LotteryState.PAID ? "The prize has been paid." : "The draw hasn't happened yet.";
      if (!view.won) return "Only the winner can claim the prize.";
      return null;
  }
}

