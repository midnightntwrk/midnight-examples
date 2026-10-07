// The coin helpers against a hand-built wallet state: no network, no wallet.

import { describe, expect, it } from 'vitest';
import {
  encodeCoinPublicKey,
  encodeRawTokenType,
  sampleContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';

import {
  type CoinWallet,
  type ShieldedStateView,
  domainSeparator,
  encryptionKeys,
  mintNonce,
  recipientOf,
  shieldedBalance,
  shieldedCoins,
  simCoin,
  takeCoin,
  tokenColor,
  waitForShieldedBalance,
} from './index.js';

const ADDRESS = sampleContractAddress();
const RED = tokenColor('test:red:', ADDRESS);
const BLUE = tokenColor('test:blue:', ADDRESS);
const nonceHex = (n: number) => n.toString(16).padStart(64, '0');

/** A wallet whose state is whatever `state()` returns at the time of the call. */
function fakeWallet(state: () => ShieldedStateView, pk = '11'.repeat(32), epk = '22'.repeat(32)): CoinWallet {
  return {
    wallet: { waitForSyncedState: async () => state() },
    getCoinPublicKey: () => pk,
    getEncryptionPublicKey: () => epk,
  };
}

const coins = (...cs: [string, number, bigint][]) =>
  cs.map(([type, n, value]) => ({ coin: { type, nonce: nonceHex(n), value } }));

const WALLET = fakeWallet(() => ({
  shielded: {
    balances: { [RED.hex]: 140n, [BLUE.hex]: 5n },
    availableCoins: coins([RED.hex, 1, 100n], [BLUE.hex, 2, 5n], [RED.hex, 3, 40n]),
  },
}));

describe('domainSeparator', () => {
  it("is Compact's pad(32, s): UTF-8, zero-filled on the right", () => {
    const d = domainSeparator('private-tip-jar:demo-token:');
    expect(d).toHaveLength(32);
    expect(new TextDecoder().decode(d.subarray(0, 27))).toBe('private-tip-jar:demo-token:');
    expect([...d.subarray(27)].every((b) => b === 0)).toBe(true);
  });

  it('refuses more than 32 bytes', () => {
    expect(() => domainSeparator('x'.repeat(33))).toThrow(/at most 32/);
  });
});

describe('tokenColor', () => {
  it('is rawTokenType of the padded domain and the minting contract, in both forms', () => {
    const hex = rawTokenType(domainSeparator('test:red:'), ADDRESS);
    expect(RED.hex).toBe(hex);
    expect(RED.bytes).toEqual(encodeRawTokenType(hex));
    expect(tokenColor(domainSeparator('test:red:'), ADDRESS)).toEqual(RED);
  });

  it('differs by domain and by contract', () => {
    expect(BLUE.hex).not.toBe(RED.hex);
    expect(tokenColor('test:red:', sampleContractAddress()).hex).not.toBe(RED.hex);
  });
});

describe('reading coins', () => {
  it('lists only coins of the color, as circuit arguments', async () => {
    const red = await shieldedCoins(WALLET, RED);
    expect(red.map((c) => c.value)).toEqual([100n, 40n]);
    expect(red[0]!.color).toEqual(RED.bytes);
    expect(Buffer.from(red[1]!.nonce).toString('hex')).toBe(nonceHex(3));
    // The hex form works too.
    expect(await shieldedCoins(WALLET, BLUE.hex)).toHaveLength(1);
  });

  it('takes the coin of an exact value, or the first', async () => {
    expect((await takeCoin(WALLET, RED, 40n)).value).toBe(40n);
    expect((await takeCoin(WALLET, RED)).value).toBe(100n);
  });

  it('says which values it saw when no coin fits', async () => {
    await expect(takeCoin(WALLET, RED, 7n)).rejects.toThrow(/saw values \[100, 40\]/);
    await expect(takeCoin(WALLET, tokenColor('test:none:', ADDRESS))).rejects.toThrow(/No coin of color .* saw values \[\]/);
  });

  it('reads balances, 0n for a color it never held', async () => {
    expect(await shieldedBalance(WALLET, RED)).toBe(140n);
    expect(await shieldedBalance(WALLET, tokenColor('test:none:', ADDRESS))).toBe(0n);
  });
});

describe('waitForShieldedBalance', () => {
  it('returns once the balance arrives', async () => {
    let polls = 0;
    const w = fakeWallet(() => ({
      shielded: { balances: ++polls >= 3 ? { [RED.hex]: 100n } : {}, availableCoins: [] },
    }));
    expect(await waitForShieldedBalance(w, RED, 100n, { pollMs: 1 })).toBe(100n);
    expect(polls).toBe(3);
  });

  it('takes a predicate', async () => {
    expect(await waitForShieldedBalance(WALLET, RED, (b) => b > 100n, { pollMs: 1 })).toBe(140n);
  });

  it('times out with the balance it last saw', async () => {
    await expect(waitForShieldedBalance(WALLET, RED, 1n, { timeoutMs: 5, pollMs: 1 })).rejects.toThrow(
      /is 140, not 1,/,
    );
  });
});

describe('minting to a wallet', () => {
  it('gives the recipient as a ZswapCoinPublicKey argument', () => {
    expect(recipientOf(WALLET)).toEqual({ bytes: encodeCoinPublicKey('11'.repeat(32)) });
  });

  it('maps each recipient coin key to its encryption key', () => {
    const other = fakeWallet(() => ({ shielded: { balances: {}, availableCoins: [] } }), '33'.repeat(32), '44'.repeat(32));
    expect(encryptionKeys(WALLET, other)).toEqual(
      new Map([
        ['11'.repeat(32), '22'.repeat(32)],
        ['33'.repeat(32), '44'.repeat(32)],
      ]),
    );
  });

  it('makes fresh 32-byte nonces', () => {
    const [a, b] = [mintNonce(), mintNonce()];
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });
});

describe('simCoin', () => {
  it('makes a coin with a random nonce, or the one given', () => {
    const c = simCoin(5n, RED.bytes);
    expect(c.value).toBe(5n);
    expect(c.color).toEqual(RED.bytes);
    expect(c.nonce).toHaveLength(32);
    const nonce = new Uint8Array(32).fill(9);
    expect(simCoin(5n, RED.bytes, nonce).nonce).toBe(nonce);
  });
});
