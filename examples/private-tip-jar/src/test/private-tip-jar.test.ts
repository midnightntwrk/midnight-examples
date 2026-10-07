// This file is part of example-private-tip-jar.
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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  encodeCoinPublicKey,
  encodeRawTokenType,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type PrivateTipJarProviders } from '../providers.js';
import { createPrivateTipJarPrivateState } from '../../contract/witnesses.js';
import {
  CompiledPrivateTipJarContract,
  CompiledTipTokenContract,
  Contract,
  TipTokenContract,
  ledger,
  pureCircuits,
  tipTokenLedger,
  zkConfigPath,
  tipTokenZkConfigPath,
  type Ledger,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
);

/**
 * Build, start, sync, and (on a remote network) fund-gate one wallet.
 *
 * Locally, ALICE and BOB are the genesis-funded seeds 01 and 02. Remotely they
 * are the shared wallets in the repo-root .env.<network>, fast-syncing from the
 * reference bundle when a birthday is recorded. See FAST-SYNC.md.
 */
async function buildWallet(
  role: 'ALICE' | 'BOB',
  env: EnvironmentConfiguration,
  faucet: string,
): Promise<MidnightWalletProvider> {
  const setup = resolveWallet(network, role);
  const w = await MidnightWalletProvider.build(logger, env, setup.secret, {
    fastSync: setup.fastSync,
  });
  await w.start();
  await syncWallet(logger, w.wallet, syncTimeoutMs);
  if (isRemote) {
    // Synced is not funded: a wallet with no DUST fails its first submit.
    await waitForNightThenDust(logger, w.wallet, w.unshieldedKeystore, env, faucet, {
      label: setup.role,
    });
  }
  return w;
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

/** The same bytes as Compact's pad(32, s): UTF-8, zero-filled on the right. */
const pad32 = (s: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(s));
  return out;
};

type ShieldedCoinArg = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type Labeled = { label: string; bytes: Uint8Array };

/**
 * Every byte string in the tip jar's PUBLIC ledger state, labelled with where
 * it came from. If a value is not in here, this contract never put it on
 * chain. Keep this in step with the `ledger` declarations in
 * private-tip-jar.compact: a field left out here is a field the privacy test
 * cannot see.
 */
function collectPublicBytes(l: Ledger): Labeled[] {
  const out: Labeled[] = [
    { label: 'owner', bytes: l.owner },
    { label: 'tipColor', bytes: l.tipColor },
  ];
  for (const [key, coin] of l.pot) {
    out.push({ label: 'pot.key', bytes: key });
    out.push({ label: 'pot.coin.nonce', bytes: coin.nonce });
    out.push({ label: 'pot.coin.color', bytes: coin.color });
  }
  return out;
}

/** The label of the public field holding `secret`, or null if none does. */
function findLeak(pool: Labeled[], secret: Uint8Array): string | null {
  const target = hex(secret);
  // Whole-field match, and also a substring match in case a secret was ever
  // packed into a wider value.
  for (const { label, bytes } of pool) if (hex(bytes).includes(target)) return label;
  return null;
}

describe(`Private Tip Jar Contract (${network})`, () => {
  let aliceWallet: MidnightWalletProvider;
  let bobWallet: MidnightWalletProvider;

  // One provider set per (wallet, contract), each with its own private-state store.
  let aliceJarProv: PrivateTipJarProviders;
  let bobJarProv: PrivateTipJarProviders;
  let aliceTokenProv: PrivateTipJarProviders;

  let tokenAddress: ContractAddress;
  let jarAddress: ContractAddress;
  let tipColorHex: string;
  let tipColorBytes: Uint8Array;

  const config = getConfig();

  const ALICE_JAR_STATE_ID = 'AliceTipJarState';
  const BOB_JAR_STATE_ID = 'BobTipJarState';

  // Alice owns the jar. Bob is a tipper; his random key is NOT the owner key,
  // which is what the non-owner withdraw test relies on.
  const aliceOwnerSk = new Uint8Array(randomBytes(32));
  const bobSk = new Uint8Array(randomBytes(32));

  // Same domain separator tip-token.compact mints with.
  const TOKEN_DOMAIN = pad32('private-tip-jar:demo-token:');

  // Bob is minted one coin of MINTED and tips it as two coins.
  const MINTED = 100n;
  const FIRST_TIP = 40n;
  const SECOND_TIP = MINTED - FIRST_TIP;

  // Things the design promises to keep off chain, recorded as the test runs.
  // The privacy test checks none of them appears in the public ledger.
  const bobIssuedNonces: Uint8Array[] = []; // nonces of coins the issuer (Alice) minted to Bob
  const bobTippedNonces: Uint8Array[] = []; // nonces of the wallet coins Bob actually tipped

  // Pot keys Alice has withdrawn, for the "withdraw twice" negative test.
  const withdrawnKeys: Uint8Array[] = [];

  async function queryLedger(): Promise<Ledger> {
    const state = await aliceJarProv.publicDataProvider.queryContractState(jarAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  /** Shielded coins of the jar's token currently in `w`. */
  async function tokenCoins(w: MidnightWalletProvider): Promise<ShieldedCoinArg[]> {
    const state = await w.wallet.waitForSyncedState();
    return state.shielded.availableCoins
      .filter((c) => c.coin.type === tipColorHex)
      .map((c) => ({
        nonce: Uint8Array.from(Buffer.from(c.coin.nonce, 'hex')),
        color: tipColorBytes,
        value: c.coin.value,
      }));
  }

  /** A coin of exactly `value` from `w`, as the `tip` circuit takes it. */
  async function takeCoin(w: MidnightWalletProvider, value: bigint): Promise<ShieldedCoinArg> {
    const coins = await tokenCoins(w);
    const coin = coins.find((c) => c.value === value);
    if (!coin) {
      const seen = coins.map((c) => c.value).join(', ');
      throw new Error(`No ${value}-token coin in wallet; saw values [${seen}]`);
    }
    return coin;
  }

  async function tokenBalance(w: MidnightWalletProvider): Promise<bigint> {
    const state = await w.wallet.waitForSyncedState();
    return state.shielded.balances[tipColorHex] ?? 0n;
  }

  async function bobTips(coin: ShieldedCoinArg): Promise<void> {
    await (submitCallTx<Contract, 'tip'>)(bobJarProv, {
      compiledContract: CompiledPrivateTipJarContract,
      contractAddress: jarAddress,
      privateStateId: BOB_JAR_STATE_ID,
      circuitId: 'tip',
      args: [coin],
    });
  }

  async function aliceWithdraws(key: Uint8Array): Promise<void> {
    await (submitCallTx<Contract, 'withdraw'>)(aliceJarProv, {
      compiledContract: CompiledPrivateTipJarContract,
      contractAddress: jarAddress,
      privateStateId: ALICE_JAR_STATE_ID,
      circuitId: 'withdraw',
      args: [key],
    });
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);

    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    aliceWallet = await buildWallet('ALICE', envConfig, config.faucet);
    bobWallet = await buildWallet('BOB', envConfig, config.faucet);

    aliceJarProv = buildProviders(aliceWallet, zkConfigPath, config);
    bobJarProv = buildProviders(bobWallet, zkConfigPath, config);
    aliceTokenProv = buildProviders(aliceWallet, tipTokenZkConfigPath, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (aliceWallet) await aliceWallet.stop();
    if (bobWallet) await bobWallet.stop();
  });

  // ---------------------------------------------------------------------------
  // Everything above is generated boilerplate, extended to two wallets and two
  // contracts. Your tests begin here.
  // ---------------------------------------------------------------------------

  it('deploys the demo token and mints Bob one coin to tip with', async () => {
    // A fresh devnet has no shielded tokens, so the tests bring their own.
    const deployed: DeployedContract<TipTokenContract> = await (deployContract<TipTokenContract>)(
      aliceTokenProv,
      { compiledContract: CompiledTipTokenContract },
    );
    tokenAddress = deployed.deployTxData.public.contractAddress;
    tipColorHex = rawTokenType(TOKEN_DOMAIN, tokenAddress);
    tipColorBytes = encodeRawTokenType(tipColorHex);
    logger.info(`Demo token at ${tokenAddress}, color ${tipColorHex}`);

    const bobCoinPk = bobWallet.getCoinPublicKey();
    await (submitCallTx<TipTokenContract, 'mint'>)(aliceTokenProv, {
      compiledContract: CompiledTipTokenContract,
      contractAddress: tokenAddress,
      circuitId: 'mint',
      args: [{ bytes: encodeCoinPublicKey(bobCoinPk) }, MINTED, new Uint8Array(randomBytes(32))],
      // Alice builds an output for Bob's wallet, so she needs his encryption key.
      additionalCoinEncPublicKeyMappings: new Map([[bobCoinPk, bobWallet.getEncryptionPublicKey()]]),
    });

    const state = await aliceTokenProv.publicDataProvider.queryContractState(tokenAddress);
    expect(tipTokenLedger(state!.data).mintCount).toEqual(1n);

    await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);
    expect(await tokenBalance(bobWallet)).toEqual(MINTED);
    // Alice chose this coin's nonce when she minted it, so she knows it.
    for (const c of await tokenCoins(bobWallet)) bobIssuedNonces.push(c.nonce);
    expect(bobIssuedNonces).toHaveLength(1);
  });

  it('Alice deploys the jar for that token; only a hash of her key is stored', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(aliceJarProv, {
      compiledContract: CompiledPrivateTipJarContract,
      privateStateId: ALICE_JAR_STATE_ID,
      initialPrivateState: createPrivateTipJarPrivateState(aliceOwnerSk),
      args: [tipColorBytes],
    });
    jarAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Tip jar deployed at: ${jarAddress}`);

    const state = await queryLedger();
    expect(hex(state.owner)).toEqual(hex(pureCircuits.ownerKey(aliceOwnerSk)));
    expect(hex(state.tipColor)).toEqual(tipColorHex);
    expect(state.pot.isEmpty()).toBe(true);

    // Bob's private state for the jar. `tip` never reads it; `withdraw` does,
    // and with his key it must fail.
    bobJarProv.privateStateProvider.setContractAddress(jarAddress);
    await bobJarProv.privateStateProvider.set(BOB_JAR_STATE_ID, createPrivateTipJarPrivateState(bobSk));
  });

  it('Bob re-nonces his coin with a self-transfer, splitting it into two tips', async () => {
    // Alice minted Bob's coin, so she knows its nonce, and the pot nonce of a
    // tip follows from the tipped coin's nonce. A self-transfer gives Bob
    // coins whose nonces only his wallet has seen.
    await bobWallet.splitShieldedCoin(tipColorHex, FIRST_TIP);
    await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);

    const coins = await tokenCoins(bobWallet);
    expect(coins.map((c) => c.value).sort()).toEqual([FIRST_TIP, SECOND_TIP].sort());
    const issued = new Set(bobIssuedNonces.map(hex));
    for (const c of coins) expect(issued.has(hex(c.nonce))).toBe(false);
  });

  it('Bob tips twice; the pot holds two contract-owned coins', async () => {
    const first = await takeCoin(bobWallet, FIRST_TIP);
    bobTippedNonces.push(first.nonce);
    await bobTips(first);

    let state = await queryLedger();
    expect(state.pot.size()).toEqual(1n);

    await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);
    const second = await takeCoin(bobWallet, SECOND_TIP);
    bobTippedNonces.push(second.nonce);
    await bobTips(second);

    state = await queryLedger();
    expect(state.pot.size()).toEqual(2n);
    // Tip VALUES are public by design: the contract must hold whole coins to
    // spend them later. What they don't carry is who paid them.
    const values = [...state.pot].map(([, coin]) => coin.value).sort();
    expect(values).toEqual([FIRST_TIP, SECOND_TIP].sort());
    for (const [key, coin] of state.pot) {
      expect(hex(coin.color)).toEqual(tipColorHex);
      expect(hex(key)).toEqual(hex(coin.nonce));
    }

    await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);
    expect(await tokenBalance(bobWallet)).toEqual(0n);
  });

  it('public state holds no tipper identity, tipped coin, or owner secret', async () => {
    const state = await queryLedger();
    const pool = collectPublicBytes(state);

    // The ledger has exactly these fields; none of them is per tipper.
    expect(Object.keys(state).sort()).toEqual(['owner', 'pot', 'tipColor']);

    const secrets: Labeled[] = [
      { label: "Bob's wallet coin public key", bytes: encodeCoinPublicKey(bobWallet.getCoinPublicKey()) },
      { label: "Bob's jar secret", bytes: bobSk },
      { label: "Alice's owner secret", bytes: aliceOwnerSk },
      { label: "Alice's wallet coin public key", bytes: encodeCoinPublicKey(aliceWallet.getCoinPublicKey()) },
      ...bobIssuedNonces.map((n) => ({ label: 'nonce of the coin Alice minted to Bob', bytes: n })),
      ...bobTippedNonces.map((n) => ({ label: 'nonce of a coin Bob tipped', bytes: n })),
    ];
    expect(bobTippedNonces).toHaveLength(2);

    for (const s of secrets) {
      const leak = findLeak(pool, s.bytes);
      expect(leak, `${s.label} found in public field ${leak}`).toBeNull();
    }
  });

  it('rejects a tip in the wrong token', async () => {
    // Rejected by the circuit's assert while the transaction is being built,
    // so a made-up coin is enough and nothing is spent.
    const wrongColor = { nonce: new Uint8Array(randomBytes(32)), color: new Uint8Array(randomBytes(32)), value: 10n };
    await expect(bobTips(wrongColor)).rejects.toThrow(/jar's token/);
  });

  it('rejects a zero-value tip', async () => {
    const empty = { nonce: new Uint8Array(randomBytes(32)), color: tipColorBytes, value: 0n };
    await expect(bobTips(empty)).rejects.toThrow(/worth something/);
  });

  it('rejects a withdrawal by anyone but the owner', async () => {
    const [key] = [...(await queryLedger()).pot][0]!;
    await expect(
      (submitCallTx<Contract, 'withdraw'>)(bobJarProv, {
        compiledContract: CompiledPrivateTipJarContract,
        contractAddress: jarAddress,
        privateStateId: BOB_JAR_STATE_ID,
        circuitId: 'withdraw',
        args: [key],
      }),
    ).rejects.toThrow(/Only the owner/);

    // Nothing moved.
    expect((await queryLedger()).pot.size()).toEqual(2n);
    expect(await tokenBalance(bobWallet)).toEqual(0n);
  });

  it('the owner withdraws every tip into her own shielded wallet', async () => {
    expect(await tokenBalance(aliceWallet)).toEqual(0n);

    for (const [key] of [...(await queryLedger()).pot]) {
      await aliceWithdraws(key);
      withdrawnKeys.push(key);
    }

    expect((await queryLedger()).pot.isEmpty()).toBe(true);
    await syncWallet(logger, aliceWallet.wallet, syncTimeoutMs);
    expect(await tokenBalance(aliceWallet)).toEqual(MINTED);
  });

  it('rejects withdrawing a tip that is not (or no longer) in the jar', async () => {
    // Already withdrawn: the pot entry is gone, so it cannot be paid twice.
    await expect(aliceWithdraws(withdrawnKeys[0]!)).rejects.toThrow(/No such tip/);
    // Never existed.
    await expect(aliceWithdraws(new Uint8Array(randomBytes(32)))).rejects.toThrow(/No such tip/);
  });
});
