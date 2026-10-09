// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/shielded-chips/src/test/roulette.test.ts);
// the differences are where `providers` came from and the three things the
// Node test reads from the wallet SDK, which the DApp Connector doesn't expose:
//
//  1. **Coin arguments.** The test passes a coin it finds in
//     `wallet.shielded.availableCoins` to houseDeposit / betColor / burn. The
//     connector can't list a wallet's coins. It doesn't need to: the
//     `ShieldedCoinInfo` a circuit `receiveShielded`s describes the *output*
//     this transaction creates for the contract, so a fresh coin
//     (`createShieldedCoinInfo`, random nonce) works, and the wallet funds it
//     from whatever chips it holds while balancing, adding change if its coin
//     is bigger. Checked on the local devnet for houseDeposit, betColor (with
//     and without change) and burn. This also gives every escrowed coin a
//     nonce the chip issuer has never seen, which the test gets from
//     `splitShieldedCoin`.
//  2. **The escrow's Merkle index.** The contract never stores a player's
//     escrowed coin, so claimWinnings / forfeit replay it from private state,
//     with its `mt_index`. See `escrowMtIndex`.
//  3. **Recipient keys for a mint.** The house mints to a player's coin public
//     key and must attach the player's encryption key, or the player's wallet
//     never finds the coin. The player shares their shielded address
//     (`mn_shield-addr_…`), which carries both; see `recipientFromAddress`.
//
// Two contracts: the UI was generated for roulette (`./contract`, the
// template's providers). The chips token is wired here, with its own
// CompiledContract and its own providers bundle from
// `useMidnightProviders().providersFor(CHIPS_ZK_ASSETS_PATH)`.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  submitCallTx,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  encodeCoinPublicKey,
  encodeRawTokenType,
  persistentHash,
  rawTokenType,
  type ContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import {
  createShieldedCoinInfo,
  ZswapOutput,
  type ShieldedCoinInfo,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { MidnightBech32m, ShieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { map, type Observable } from "rxjs";
import {
  Contract as ChipsContractClass,
  ledger as chipsLedger,
  type Ledger as ChipsLedger,
} from "../../../contract/managed/chips/contract/index.js";
import { BetState, Color } from "../../../contract/managed/roulette/contract/index.js";
import { chipsWitnesses, rememberEscrow } from "../../../contract/witnesses.js";
import {
  CompiledShieldedChipsContract,
  createInitialPrivateState,
  PRIVATE_STATE_ID,
  type Contract,
  ledger,
  type Ledger,
  type ShieldedChipsPrivateState,
} from "./contract";
import type { ContractProviders, ShieldedChipsProviders } from "./providers";

export { BetState, Color, type ChipsLedger };

// --- values shared with the Node test ----------------------------------------

/** MIP-0011 metadata, fixed at construction (same as the Node test). */
export const CHIP_NAME = "Roulette Chips";
export const CHIP_SYMBOL = "CHIP";
export const CHIP_DECIMALS = 0n;
/** The chips contract's domain separator: pad(32, "roulette:chip:"). */
export const CHIP_DOMAIN = pad32("roulette:chip:");

/** A roulette wheel's numbers: 0 is GREEN, odd numbers RED, even BLACK. */
export const MAX_NUMBER = 36n;

function pad32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label));
  return out;
}

/** 32 bytes from the browser's CSPRNG: secret keys, salts, mint nonces. */
export function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

// --- the chips token (second contract) ----------------------------------------

/** Where copy-zk.mjs serves the chips keys and zkir. */
export const CHIPS_ZK_ASSETS_PATH = "managed/chips";

/** Every provable chips circuit, i.e. every key set served for it. */
export type ChipsCircuits = keyof ChipsContractClass["provableCircuits"] & string;
export type ChipsProviders = ContractProviders<ChipsCircuits>;

/** Same construction as CompiledChipsContract in contract/index.ts. */
export const CompiledChipsContract = CompiledContract.make("ChipsContract", ChipsContractClass).pipe(
  CompiledContract.withWitnesses(chipsWitnesses),
  CompiledContract.withCompiledFileAssets(CHIPS_ZK_ASSETS_PATH),
);

/**
 * The house deploys the chips token. Its private state holds the house's
 * secret key (`localSecretKey`), the same one the roulette contract is then
 * deployed with: both contracts check `getDappPublicKey(sk) == theHouse`.
 */
export async function deployChips(
  providers: ChipsProviders,
  sk: Uint8Array,
): Promise<ContractAddress> {
  const deployed = await deployContract(providers, {
    compiledContract: CompiledChipsContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(sk),
    args: [CHIP_NAME, CHIP_SYMBOL, CHIP_DECIMALS, CHIP_DOMAIN],
  });
  return deployed.deployTxData.public.contractAddress;
}

/**
 * The house's secret key, from the private state stored when this browser
 * deployed the chips contract at `chipsAddress`; null when it didn't.
 */
export async function readHouseSecret(
  providers: ChipsProviders,
  chipsAddress: ContractAddress,
): Promise<Uint8Array | null> {
  providers.privateStateProvider.setContractAddress(chipsAddress);
  return (await providers.privateStateProvider.get(PRIVATE_STATE_ID))?.sk ?? null;
}

/**
 * The chip color: `tokenType(domain, chipsAddress)`, computed off chain as in
 * the Node test (MIP-0011 forbids storing it at construction). Hex is how
 * wallets key their balances; bytes are what the roulette constructor takes.
 */
export function chipColor(chipsAddress: ContractAddress): { hex: string; bytes: Uint8Array } {
  const hex = rawTokenType(CHIP_DOMAIN, chipsAddress);
  return { hex, bytes: encodeRawTokenType(hex) };
}

export function chipsLedger$(
  providers: ChipsProviders,
  address: ContractAddress,
): Observable<ChipsLedger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => chipsLedger(state.data)));
}

/** A shielded recipient: hex coin public key and encryption public key. */
export interface ShieldedRecipient {
  coinPublicKey: string;
  encryptionPublicKey: string;
}

/**
 * Decode a shielded address (`mn_shield-addr_<network>1…`, what the
 * connector's `getShieldedAddresses().shieldedAddress` returns) into the two
 * keys a mint needs. Throws for anything else, or another network's address.
 */
export function recipientFromAddress(bech32: string, networkId: string): ShieldedRecipient {
  const address = ShieldedAddress.codec.decode(networkId, MidnightBech32m.parse(bech32.trim()));
  return {
    coinPublicKey: address.coinPublicKeyString(),
    encryptionPublicKey: address.encryptionPublicKeyString(),
  };
}

/** Shared options for every chips call: the house's stored state signs for it. */
function chipsCall(chipsAddress: ContractAddress) {
  return {
    compiledContract: CompiledChipsContract,
    contractAddress: chipsAddress,
    privateStateId: PRIVATE_STATE_ID,
  } as const;
}

/**
 * Mint `amount` chips to `recipient` (house only). The nonce is fresh and
 * secret: MIP-0011 puts uniqueness on the caller, and without the nonce nobody
 * can recompute the recipient's coin commitment. `mint` creates no ciphertext
 * of its own, so the recipient's encryption key goes in
 * `additionalCoinEncPublicKeyMappings`; without it their wallet never sees the
 * coin. Uses submitCallTx because a FoundContract's callTx has no such option.
 */
export async function mintChips(
  providers: ChipsProviders,
  chipsAddress: ContractAddress,
  recipient: ShieldedRecipient,
  amount: bigint,
) {
  return submitCallTx(providers, {
    ...chipsCall(chipsAddress),
    circuitId: "mint",
    args: [{ bytes: encodeCoinPublicKey(recipient.coinPublicKey) }, amount, randomBytes32()],
    additionalCoinEncPublicKeyMappings: new Map([
      [recipient.coinPublicKey, recipient.encryptionPublicKey],
    ]),
  });
}

/**
 * Burn `amount` of the house's own chips (house only): the transient path. The
 * coin is a fresh one of exactly `amount`, so there is no refund; the wallet
 * funds it from the chips it holds.
 */
export async function burnChips(
  providers: ChipsProviders,
  chipsAddress: ContractAddress,
  colorHex: string,
  amount: bigint,
) {
  return submitCallTx(providers, {
    ...chipsCall(chipsAddress),
    circuitId: "burn",
    args: [freshChip(colorHex, amount).arg, amount],
  });
}

/** Mint `amount` chips into the contract's own treasury (house only). */
export async function mintToTreasury(
  providers: ChipsProviders,
  chipsAddress: ContractAddress,
  amount: bigint,
) {
  return submitCallTx(providers, {
    ...chipsCall(chipsAddress),
    circuitId: "mintToTreasury",
    args: [amount, randomBytes32()],
  });
}

/** Burn `amount` of the treasury coin under `key` (house only): the Merkle path. */
export async function burnFromTreasury(
  providers: ChipsProviders,
  chipsAddress: ContractAddress,
  key: Uint8Array,
  amount: bigint,
) {
  return submitCallTx(providers, {
    ...chipsCall(chipsAddress),
    circuitId: "burnFromTreasury",
    args: [key, amount],
  });
}

/**
 * A fresh chip coin of `value`, for a circuit that `receiveShielded`s it: the
 * ledger form (hex, for computing its commitment) and the circuit argument.
 */
export function freshChip(colorHex: string, value: bigint) {
  const coin = createShieldedCoinInfo(colorHex, value);
  return {
    coin,
    arg: { nonce: fromHexBytes(coin.nonce), color: encodeRawTokenType(colorHex), value },
  };
}

function fromHexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

// --- the roulette contract (the UI's own) -------------------------------------

export type ShieldedChipsContract = FoundContract<Contract>;

/** What the house supplies to deploy a roulette table. */
export interface RouletteDeployInput {
  /** The house secret key, the one the chips contract was deployed with. */
  sk: Uint8Array;
  /** The chip color (bytes) the table accepts. */
  chipColor: Uint8Array;
  /** The winning number, 0..36, committed as H(number, sk) until revealed. */
  winningNumber: bigint;
}

/**
 * Deploy a roulette table (house only). Only `H(number, sk)` goes on chain;
 * the house gets the number back later with `recoverWinningNumber`, so
 * nothing but `sk` needs storing.
 */
export async function deployShieldedChips(
  providers: ShieldedChipsProviders,
  input: RouletteDeployInput,
): Promise<{ contract: ShieldedChipsContract; address: ContractAddress }> {
  const deployed = await deployContract(providers, {
    compiledContract: CompiledShieldedChipsContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(input.sk, randomBytes32()),
    args: [input.winningNumber, input.chipColor],
  });
  return {
    contract: deployed,
    address: deployed.deployTxData.public.contractAddress,
  };
}

/**
 * A new player's private state: a fresh secret key (their pseudonym at this
 * table) and a fresh escrow salt. The salt blinds the escrow commitment, so
 * the chip issuer, who knows every coin it minted, can't recompute it. Never
 * the factory's all-zero default.
 */
export function newPlayerState(): ShieldedChipsPrivateState {
  return createInitialPrivateState(randomBytes32(), randomBytes32());
}

/**
 * Attach to a table by address. findDeployedContract fetches the on-chain
 * state and checks that its verifier keys match the ones we serve.
 *
 * Private state: findDeployedContract *overwrites* whatever is stored under
 * PRIVATE_STATE_ID whenever it is given an `initialPrivateState`. So reuse the
 * stored state when there is one (a reload, or the house coming back) and
 * only create a new player's state otherwise.
 */
export async function joinShieldedChips(
  providers: ShieldedChipsProviders,
  address: ContractAddress,
): Promise<ShieldedChipsContract> {
  providers.privateStateProvider.setContractAddress(address);
  const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (stored !== null) {
    return findDeployedContract(providers, {
      compiledContract: CompiledShieldedChipsContract,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
    });
  }
  return findDeployedContract(providers, {
    compiledContract: CompiledShieldedChipsContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: newPlayerState(),
  });
}

/** This browser's private state for the table at `address`, if any. */
export async function readPrivateState(
  providers: ShieldedChipsProviders,
  address: ContractAddress,
): Promise<ShieldedChipsPrivateState | null> {
  providers.privateStateProvider.setContractAddress(address);
  return providers.privateStateProvider.get(PRIVATE_STATE_ID);
}

/**
 * A circuit's arguments without its leading CircuitContext, i.e. what
 * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx
 * members are overloaded, and `Parameters` picks the last overload, whose
 * first parameter is a TransactionContext.
 */
export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =
  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;

/**
 * Deposit a match coin of `value` chips (house only). A winner's claim merges
 * their escrow with one match coin of the same value, so deposit one per
 * expected winning bet of that size.
 */
export async function houseDeposit(contract: ShieldedChipsContract, colorHex: string, value: bigint) {
  return contract.callTx.houseDeposit(freshChip(colorHex, value).arg);
}

/**
 * Bet `value` chips on RED or BLACK, then record the escrowed coin in private
 * state: claimWinnings / forfeit replay it, and nothing else can.
 *
 * The coin (nonce, color, value) is stored *before* the call, so a page that
 * dies mid-call still has it. midnight-js then stores the call's resulting
 * private state, which is that same state (betColor's witnesses only read).
 * Only the Merkle index is filled in afterwards, from the finalized tx.
 */
export async function placeBet(
  contract: ShieldedChipsContract,
  providers: ShieldedChipsProviders,
  address: ContractAddress,
  indexerUri: string,
  colorHex: string,
  value: bigint,
  color: Color,
) {
  const base = await readPrivateState(providers, address);
  if (!base) throw new Error("No private state for this table: rejoin it first.");
  const { coin, arg } = freshChip(colorHex, value);
  const pending = rememberEscrow(base, { ...arg, mt_index: 0n });
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, pending);

  const tx = await contract.callTx.betColor(arg, color);

  const mtIndex = await escrowMtIndex(indexerUri, tx.public, coin, address);
  providers.privateStateProvider.setContractAddress(address);
  await providers.privateStateProvider.set(
    PRIVATE_STATE_ID,
    rememberEscrow(base, { ...arg, mt_index: mtIndex }),
  );
  return tx;
}

/**
 * The Zswap Merkle-tree index of the coin a bet escrowed.
 *
 * Every output of a transaction is appended to the tree in order, starting at
 * the transaction's `zswapStartIndex` (the indexer has it). So the escrow's
 * index is that start plus the escrow output's position in the transaction.
 * The position is not always 0: when the wallet adds a change output, it can
 * come first (seen on the devnet with a 150-chip coin and a 100-chip bet). So
 * find it by commitment: a contract-owned output's commitment follows from the
 * coin and the contract address alone.
 */
export async function escrowMtIndex(
  indexerUri: string,
  tx: FinalizedTxData,
  coin: ShieldedCoinInfo,
  address: ContractAddress,
): Promise<bigint> {
  const expected = ZswapOutput.newContractOwned(coin, 0, address).commitment;
  const position = (tx.tx.guaranteedOffer?.outputs ?? []).findIndex((o) => o.commitment === expected);
  if (position < 0) {
    throw new Error("The bet transaction has no output for the escrowed coin.");
  }
  const start = await zswapStartIndex(indexerUri, tx.txId);
  return BigInt(start + position);
}

async function zswapStartIndex(indexerUri: string, txId: string): Promise<number> {
  const query = `query ($id: HexEncoded!) { transactions(offset: { identifier: $id }) {
    ... on RegularTransaction { zswapStartIndex } } }`;
  const res = await fetch(indexerUri, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: txId } }),
  });
  if (!res.ok) throw new Error(`Indexer query failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { transactions?: { zswapStartIndex?: number }[] };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`Indexer query failed: ${body.errors[0]!.message}`);
  const start = body.data?.transactions?.[0]?.zswapStartIndex;
  if (start === undefined) throw new Error(`The indexer has no zswap index for tx ${txId}.`);
  return start;
}

/** Reveal the winning number (house only); closes betting. */
export async function revealWinningNumber(contract: ShieldedChipsContract, winningNumber: bigint) {
  return contract.callTx.revealWinningNumber(winningNumber);
}

/**
 * Claim 2x (a winner): the escrowed coin merged with a match coin of the same
 * value, paid to this wallet. `matchKey` is a `houseCoins` key; see `matchKeyFor`.
 */
export async function claimWinnings(contract: ShieldedChipsContract, matchKey: Uint8Array) {
  return contract.callTx.claimWinnings(matchKey);
}

/** Hand a losing bet's escrow to the house pool (a loser). */
export async function forfeit(contract: ShieldedChipsContract) {
  return contract.callTx.forfeit();
}

/** Sweep one pool coin back to the house wallet (house only). */
export async function houseClaimMatch(contract: ShieldedChipsContract, matchKey: Uint8Array) {
  return contract.callTx.houseClaimMatch(matchKey);
}

/**
 * Live view of the table's public ledger. The indexer pushes each new
 * contract state over its websocket, and the compiler-generated `ledger()`
 * decodes it.
 */
export function ledger$(
  providers: ShieldedChipsProviders,
  address: ContractAddress,
): Observable<Ledger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data)));
}

// --- pure helpers: who am I, what can I do (tested against the circuits) ------

const PK_TYPE = new CompactTypeVector(2, new CompactTypeBytes(32));
const PK_DOMAIN = pad32("roulette:pk:");

/** `getDappPublicKey(sk)`: this table's pseudonym for a secret key. */
export function dappPublicKey(sk: Uint8Array): Uint8Array {
  return persistentHash(PK_TYPE, [PK_DOMAIN, sk]);
}

/** `commitWithSk(number as Bytes<32>, sk)`, the constructor's commitment. */
export function winningNumberCommitment(winningNumber: bigint, sk: Uint8Array): Uint8Array {
  return persistentHash(PK_TYPE, [convertFieldToBytes(32, winningNumber, "winningNumberCommitment"), sk]);
}

/**
 * The winning number the house committed to, recovered from its secret key:
 * there are only 37 candidates. Null when `sk` isn't the house's.
 */
export function recoverWinningNumber(state: Ledger, sk: Uint8Array): bigint | null {
  const target = toHex(state.winningNumHash);
  for (let n = 0n; n <= MAX_NUMBER; n++) {
    if (toHex(winningNumberCommitment(n, sk)) === target) return n;
  }
  return null;
}

/** getColor: 0 is GREEN, odd RED, even BLACK. */
export function colorOf(winningNumber: bigint): Color {
  if (winningNumber === 0n) return Color.GREEN;
  return winningNumber % 2n === 1n ? Color.RED : Color.BLACK;
}

export type Role = "house" | "player";

/** House when this browser's key is the table's `theHouse`; anyone else plays. */
export function roleOf(state: Ledger, ps: ShieldedChipsPrivateState | null): Role | null {
  if (!ps) return null;
  return sameBytes(dappPublicKey(ps.sk), state.theHouse) ? "house" : "player";
}

/** A player's view of their own bet at this table. */
export interface PlayerView {
  pk: Uint8Array;
  bet: Color | null;
  /** The escrowed value while the escrow is still in the contract. */
  escrowValue: bigint | null;
  paid: boolean;
}

export function playerView(state: Ledger, ps: ShieldedChipsPrivateState): PlayerView {
  const pk = dappPublicKey(ps.sk);
  return {
    pk,
    bet: state.bets.member(pk) ? state.bets.lookup(pk) : null,
    escrowValue: state.betValues.member(pk) ? state.betValues.lookup(pk) : null,
    paid: state.paidWinners.member(pk),
  };
}

/** A pool coin a winner can merge with: the first one worth exactly their bet. */
export function matchKeyFor(state: Ledger, value: bigint): Uint8Array | null {
  for (const [key, coin] of state.houseCoins) if (coin.value === value) return key;
  return null;
}

export type Action = "bet" | "claim" | "forfeit";

/**
 * Why `action` would fail right now, mirroring the circuit's asserts in
 * order; null when it would pass. `escrowRecorded` is false while the bet's
 * Merkle index isn't known (claim and forfeit replay the escrow with it).
 */
export function actionError(
  action: Action,
  state: Ledger,
  ps: ShieldedChipsPrivateState,
  opts: { betColor?: Color; escrowRecorded?: boolean } = {},
): string | null {
  const view = playerView(state, ps);
  const isHouse = sameBytes(view.pk, state.theHouse);
  if (action === "bet") {
    if (state.betState !== BetState.OPEN) return "Not ready to accept bets yet";
    if (opts.betColor !== Color.RED && opts.betColor !== Color.BLACK)
      return "Only RED or BLACK bets are allowed";
    if (isHouse) return "theHouse cannot make bets";
    if (state.betCommits.member(view.pk)) return "Already placed a bet this round";
    return null;
  }
  if (state.betState !== BetState.CLOSED) return "Winning number has not been revealed";
  if (view.bet === null) return "You did not place a bet";
  if (action === "claim") {
    if (view.bet !== state.winningColor) return "You did not place a winning bet";
    if (view.paid) return "Already claimed";
  } else {
    if (view.bet === state.winningColor) return "You won — claim instead";
    if (!state.betCommits.member(view.pk)) return "Nothing to forfeit";
  }
  if (opts.escrowRecorded === false) return "This browser has no record of the escrowed coin";
  if (action === "claim") {
    if (view.escrowValue === null || matchKeyFor(state, view.escrowValue) === null)
      return "Match coin not available";
  }
  return null;
}

/**
 * True once a bet's escrow has its Merkle index (see placeBet). Index 0 is
 * the chain's very first coin, so it never belongs to a bet on a live network;
 * placeBet uses it to mean "not resolved yet".
 */
export function escrowRecorded(ps: ShieldedChipsPrivateState): boolean {
  return ps.escrowedCoin.value > 0n && ps.escrowedCoin.mt_index > 0n;
}

/**
 * A chip amount typed by the user: a positive whole number below 2^64 (bets
 * and match coins are stored as Uint<64>), or null.
 */
export function parseAmount(text: string): bigint | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const v = BigInt(text.trim());
  return v > 0n && v < 2n ** 64n ? v : null;
}

/** A winning number 0..36, or null (the constructor asserts that range). */
export function parseNumber(text: string): bigint | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const v = BigInt(text.trim());
  return v <= MAX_NUMBER ? v : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
