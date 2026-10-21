// Shielded-coin helpers for the examples' tests.
//
// A contract that takes a shielded coin (a tip, a bet, a deposit) declares a
// `ShieldedCoinInfo` argument: { nonce, color, value }, and calls
// `receiveShielded` on it. That argument is not one of the wallet's coins. It
// describes a NEW coin the transaction creates for the contract, and the
// wallet pays for it from whichever coins it selects, making change. So the
// argument comes from `freshCoin(color, value)`, with a random nonce. Never
// copy a wallet coin's nonce into it: that nonce is also in the wallet coin's
// commitment, so publishing it (or anything derived from it) links the
// contract's coin to that wallet coin, and whoever minted or sent it to you
// knows it.
//
// Every shielded example used to write its own converters, token-color
// derivation and balance polling. They live here instead. The helpers take a
// structural wallet (CoinWallet), not an example's MidnightWalletProvider,
// because each example owns its src/wallet.ts and they drift. Any provider
// with `wallet.waitForSyncedState()` and the two public keys fits.

import { randomBytes } from 'node:crypto';
import {
  type ContractAddress,
  decodeShieldedCoinInfo,
  encodeCoinPublicKey,
  encodeRawTokenType,
  encodeShieldedCoinInfo,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { createShieldedCoinInfo, rawTokenType, ZswapOutput } from '@midnight-ntwrk/midnight-js-protocol/ledger';

/** A coin as a circuit takes it: Compact's `ShieldedCoinInfo`. */
export type ShieldedCoinArg = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/** A token color in both forms: `hex` is what the wallet keys coins and balances by, `bytes` what circuits take. */
export type TokenColor = { hex: string; bytes: Uint8Array };

/**
 * The slice of the wallet facade's state these helpers read. `FacadeState`
 * from @midnight-ntwrk/wallet-sdk fits it, and so does a hand-built object in
 * a unit test.
 */
export interface ShieldedStateView {
  shielded: {
    /** Spendable balance per token color (hex). */
    balances: Record<string, bigint>;
    /** Spendable coins; `type` and `nonce` are hex. */
    availableCoins: readonly { coin: { type: string; nonce: string; value: bigint } }[];
  };
}

/** What the helpers need from a wallet provider. Every example's MidnightWalletProvider has it. */
export interface CoinWallet {
  wallet: { waitForSyncedState(): Promise<ShieldedStateView> };
  /** Hex coin public key. */
  getCoinPublicKey(): string;
  /** Hex encryption public key. */
  getEncryptionPublicKey(): string;
}

const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
const colorHex = (color: TokenColor | string): string => (typeof color === 'string' ? color : color.hex);

/**
 * The same 32 bytes as Compact's `pad(32, s)`: UTF-8, zero-filled on the
 * right. A contract that mints with `pad(32, "my-app:token:")` as its domain
 * separator gets its color from `tokenColor(domainSeparator("my-app:token:"), …)`.
 */
export function domainSeparator(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  if (utf8.length > 32) throw new Error(`domain separator '${s}' is ${utf8.length} bytes; pad(32, …) takes at most 32`);
  const out = new Uint8Array(32);
  out.set(utf8);
  return out;
}

/**
 * The color of the token a contract mints under `domain`. A token's color is
 * hash(domain separator, minting contract's address), so it is known only
 * once the minting contract is deployed. Derive it off chain like this rather
 * than storing it in the contract: MIP-0011 forbids computing it in the
 * constructor, where `kernel.self()` resolves differently.
 */
export function tokenColor(domain: string | Uint8Array, contractAddress: ContractAddress): TokenColor {
  const hex = rawTokenType(typeof domain === 'string' ? domainSeparator(domain) : domain, contractAddress);
  return { hex, bytes: encodeRawTokenType(hex) };
}

/**
 * The wallet's spendable coins of `color`, in circuit-argument form. Waits for
 * the wallet to be synced. Useful for reading nonces (a privacy test checks
 * none of them reaches public state). Don't pass one to a circuit that
 * `receiveShielded`s it: use `freshCoin`.
 */
export async function shieldedCoins(w: CoinWallet, color: TokenColor | string): Promise<ShieldedCoinArg[]> {
  const hex = colorHex(color);
  const bytes = encodeRawTokenType(hex);
  const state = await w.wallet.waitForSyncedState();
  return state.shielded.availableCoins
    .filter((c) => c.coin.type === hex)
    .map((c) => ({ nonce: fromHex(c.coin.nonce), color: bytes, value: c.coin.value }));
}

/**
 * The argument for a circuit that `receiveShielded`s a coin: a new coin of
 * `value` with a uniformly random nonce (the ledger's `createShieldedCoinInfo`).
 * The wallet pays for it when it balances the transaction, from whichever
 * coins of `color` it selects, and takes the change back under fresh nonces.
 * So any amount works without making an exact-value coin first, and the nonce
 * is in no commitment but the contract's own.
 *
 * The contract can't tell a fresh nonce from a reused one. If it keys a map by
 * this nonce, it should refuse one already present (a same-nonce coin of a
 * different value would overwrite the entry).
 */
export function freshCoin(color: TokenColor | string, value: bigint): ShieldedCoinArg {
  return encodeShieldedCoinInfo(createShieldedCoinInfo(colorHex(color), value));
}

/**
 * The slice of a finalized transaction `contractCoinMtIndex` reads: its id and
 * its guaranteed Zswap outputs. `FinalizedTxData` from submitCallTx's
 * `.public` fits it.
 */
export interface TxWithOutputs {
  txId: string;
  tx: { guaranteedOffer?: { outputs: readonly { commitment: string }[] } };
}

/**
 * The Zswap Merkle-tree index of `coin`, a coin that `tx` created for the
 * contract at `contractAddress` (`receiveShielded`), as `mt_index` for
 * spending it later with `sendShielded`.
 *
 * A contract that stores a coin with `insertCoin` gets the index for free. One
 * that keeps the coin off chain (an escrow it holds only a commitment to)
 * leaves its depositor to recover it. A transaction's outputs enter the tree
 * in order from its `zswapStartIndex` (the indexer has it), so the index is
 * that start plus the coin's position among the outputs. The position is found
 * by commitment, because the wallet's change output can come first. A
 * contract-owned output's commitment follows from the coin and the address.
 */
export async function contractCoinMtIndex(
  indexerUri: string,
  tx: TxWithOutputs,
  coin: ShieldedCoinArg,
  contractAddress: ContractAddress,
): Promise<bigint> {
  const expected = ZswapOutput.newContractOwned(decodeShieldedCoinInfo(coin), 0, contractAddress).commitment;
  const position = (tx.tx.guaranteedOffer?.outputs ?? []).findIndex((o) => o.commitment === expected);
  if (position < 0) throw new Error(`Transaction ${tx.txId} has no output for that coin to ${contractAddress}`);
  const query = `query ($id: HexEncoded!) { transactions(offset: { identifier: $id }) {
    ... on RegularTransaction { zswapStartIndex } } }`;
  const res = await fetch(indexerUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: tx.txId } }),
  });
  if (!res.ok) throw new Error(`Indexer query failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { transactions?: { zswapStartIndex?: number }[] };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`Indexer query failed: ${body.errors[0]!.message}`);
  const start = body.data?.transactions?.[0]?.zswapStartIndex;
  if (start === undefined) throw new Error(`The indexer has no zswap index for tx ${tx.txId}`);
  return BigInt(start + position);
}

/**
 * One spendable coin of `color` from the wallet: one worth exactly `value` if
 * given, else the first.
 *
 * @deprecated Don't pass a wallet coin to a circuit that `receiveShielded`s it.
 * The argument describes a new coin, so use `freshCoin(color, value)`: the
 * wallet pays for it and makes change. Passing this coin instead puts its
 * nonce, which its minter or sender knows, into the contract's coin.
 */
export async function takeCoin(w: CoinWallet, color: TokenColor | string, value?: bigint): Promise<ShieldedCoinArg> {
  const coins = await shieldedCoins(w, color);
  const coin = value === undefined ? coins[0] : coins.find((c) => c.value === value);
  if (!coin) {
    const want = value === undefined ? 'coin' : `${value}-value coin`;
    throw new Error(
      `No ${want} of color ${colorHex(color).slice(0, 16)}… in the wallet; ` +
        `saw values [${coins.map((c) => c.value).join(', ')}]. ` +
        'Has the mint or transfer that pays it been synced? See waitForShieldedBalance.',
    );
  }
  return coin;
}

/** The wallet's spendable balance of `color` (0n if it holds none). */
export async function shieldedBalance(w: CoinWallet, color: TokenColor | string): Promise<bigint> {
  const state = await w.wallet.waitForSyncedState();
  return state.shielded.balances[colorHex(color)] ?? 0n;
}

/**
 * Polls until the balance of `color` equals `until` (or `until(balance)` is
 * true), and returns it. A submitted transaction is accepted before it is on
 * chain and indexed, so a coin minted or sent to a wallet shows up some
 * seconds later: wait for it before the next call that pays from it.
 */
export async function waitForShieldedBalance(
  w: CoinWallet,
  color: TokenColor | string,
  until: bigint | ((balance: bigint) => boolean),
  opts: { timeoutMs?: number; pollMs?: number; logger?: { info(msg: string): void } } = {},
): Promise<bigint> {
  const done = typeof until === 'bigint' ? (b: bigint) => b === until : until;
  const { timeoutMs = 300_000, pollMs = 2_000, logger } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const balance = await shieldedBalance(w, color);
    if (done(balance)) return balance;
    if (Date.now() >= deadline) {
      throw new Error(
        `Balance of ${colorHex(color).slice(0, 16)}… is ${balance}` +
          (typeof until === 'bigint' ? `, not ${until},` : '') +
          ` after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    logger?.info(`Waiting for balance of ${colorHex(color).slice(0, 16)}… (now ${balance})`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * The wallet as a mint or send recipient: the `ZswapCoinPublicKey` argument
 * ({ bytes }) of a circuit like `mint(recipient, amount, nonce)`.
 */
export function recipientOf(w: CoinWallet): { bytes: Uint8Array } {
  return { bytes: encodeCoinPublicKey(w.getCoinPublicKey()) };
}

/**
 * `additionalCoinEncPublicKeyMappings` for a call that creates coins for
 * other wallets. The caller's wallet builds the output coin and must encrypt
 * it to the recipient, so it needs each recipient's encryption key, keyed by
 * coin public key. Without it the coin is made but the recipient's wallet
 * never sees it.
 */
export function encryptionKeys(...recipients: CoinWallet[]): Map<string, string> {
  return new Map(recipients.map((w) => [w.getCoinPublicKey(), w.getEncryptionPublicKey()]));
}

/**
 * A fresh random nonce for a mint. The circuit can't make one: uniqueness is
 * the caller's job (MIP-0011), and the nonce stays secret between minter and
 * recipient, which is what keeps the recipient unlinkable to outsiders.
 */
export function mintNonce(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/**
 * A made-up coin for an in-memory (Sim) test. Sim doesn't check that a coin
 * exists or is paid for, so any nonce does; a random one by default. On the
 * devnet use `freshCoin`.
 */
export function simCoin(value: bigint, color: Uint8Array, nonce: Uint8Array = mintNonce()): ShieldedCoinArg {
  return { nonce, color, value };
}
