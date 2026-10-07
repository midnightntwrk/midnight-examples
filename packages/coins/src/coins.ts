// Shielded-coin helpers for the examples' tests.
//
// A contract that takes a shielded coin (a tip, a bet, a deposit) declares a
// `ShieldedCoinInfo` argument: { nonce, color, value }. The wallet holds the
// same coin as hex strings plus a Merkle index. Every shielded example used to
// write its own converters for that, plus the token-color derivation and the
// balance polling. They live here instead.
//
// The helpers take a structural wallet (CoinWallet), not an example's
// MidnightWalletProvider, because each example owns its src/wallet.ts and they
// drift. Any provider with `wallet.waitForSyncedState()` and the two public
// keys fits. The re-nonce self-transfer stays in src/wallet.ts
// (`splitShieldedCoin`): it needs the wallet's secret keys.

import { randomBytes } from 'node:crypto';
import {
  type ContractAddress,
  encodeCoinPublicKey,
  encodeRawTokenType,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';

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

/** The wallet's spendable coins of `color`, as circuit arguments. Waits for the wallet to be synced. */
export async function shieldedCoins(w: CoinWallet, color: TokenColor | string): Promise<ShieldedCoinArg[]> {
  const hex = colorHex(color);
  const bytes = encodeRawTokenType(hex);
  const state = await w.wallet.waitForSyncedState();
  return state.shielded.availableCoins
    .filter((c) => c.coin.type === hex)
    .map((c) => ({ nonce: fromHex(c.coin.nonce), color: bytes, value: c.coin.value }));
}

/**
 * One spendable coin of `color`: one worth exactly `value` if given, else the
 * first. A circuit that takes a whole coin spends all of it, so to pay an
 * exact amount make that coin first with `splitShieldedCoin(color, value)`
 * (src/wallet.ts).
 *
 * PRIVACY: whoever minted or paid you a coin knows its nonce, and can spot it
 * (or a contract coin re-nonced from it) on chain. If the action should be
 * unlinkable, re-nonce with `splitShieldedCoin` before taking the coin.
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
 * seconds later: wait for it before `takeCoin`.
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
 * exists, so any nonce does; a random one by default.
 */
export function simCoin(value: bigint, color: Uint8Array, nonce: Uint8Array = mintNonce()): ShieldedCoinArg {
  return { nonce, color, value };
}
