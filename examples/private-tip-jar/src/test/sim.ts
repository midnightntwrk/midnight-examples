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

// Copied from packages/sim/src/sim.ts and packages/sim/src/privacy.ts in
// midnight-examples so the example only depends on published @midnight-ntwrk
// packages.
//
//
// In-memory deploy-and-call harness for a compiled Compact contract.
//
// Runs the compiler's JS output (contract/managed/<c>/contract/index.js) with
// compact-runtime, so it needs no proof server, node or indexer. Proving keys
// aren't used either: `npm run compile:fast` (--skip-zk) output is enough.
//
// Each call() is its own transaction: a fresh circuit context built from the
// current public state, the current private state and the caller's coin
// public key, the way examples/calculator/ui/src/__tests__/
// calculator-circuits.test.ts does it.
//
// From compact-runtime 0.20 (Compact 0.35) the constructor and circuits are
// async, and createCircuitContext takes one options object; so deploy(),
// call() and expectRejects() here are async too.

import {
  type ChargedState,
  type CircuitContext,
  type CircuitResults,
  type ConstructorContext,
  type ConstructorResult,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';

/** Coin public key used when the test doesn't pick one (hex, 32 bytes). */
export const SIM_COIN_PUBLIC_KEY = '00'.repeat(32);

/** The parts of a compiler-generated `Contract<PS>` the harness uses. */
export interface SimContract<PS> {
  initialState(context: ConstructorContext<PS>, ...args: never[]): Promise<ConstructorResult<PS>>;
  impureCircuits: object;
}

type ImpureOf<C> = C extends { impureCircuits: infer I } ? I : never;
type CircuitName<C> = keyof ImpureOf<C> & string;
type CircuitFn<C, K extends CircuitName<C>> = ImpureOf<C>[K] extends (...a: infer A) => infer R
  ? (...a: A) => R
  : never;
/** A circuit's arguments, without the leading context. */
export type CircuitArgs<C, K extends CircuitName<C>> =
  Parameters<CircuitFn<C, K>> extends [unknown, ...infer Rest] ? Rest : never;
/** What a circuit returns in Compact. */
export type CircuitResult<C, K extends CircuitName<C>> =
  Awaited<ReturnType<CircuitFn<C, K>>> extends CircuitResults<unknown, infer R> ? R : never;
/** The constructor's arguments, without the leading context. */
export type ConstructorArgs<C> = C extends {
  initialState(context: never, ...args: infer A): unknown;
}
  ? A
  : never;

export interface DeployOptions<C, PS, L> {
  /** The compiled contract, e.g. `new Contract(witnesses)`. */
  contract: C;
  /** The compiled `ledger` function, which decodes public state. */
  ledger: (state: ChargedState) => L;
  privateState: PS;
  /** Constructor arguments, in declaration order. */
  args?: ConstructorArgs<C>;
  /** Hex coin public key of the deployer (and of later callers until as()). */
  coinPublicKey?: string;
}

export class Sim<C extends SimContract<PS>, PS, L> {
  /** The contract's address in this simulation (kernel.self()). */
  readonly address = sampleContractAddress();
  /** Coin public key of the caller for the next call(); change with as(). */
  coinPublicKey: string;
  /** The private state the next call's witnesses see. Assign to swap it. */
  privateState: PS;
  /** The context the last call returned: zswap inputs/outputs, gas, etc. */
  lastContext: CircuitContext<PS> | undefined;

  private state: ChargedState;

  private constructor(
    readonly contract: C,
    private readonly decode: (state: ChargedState) => L,
    state: ChargedState,
    privateState: PS,
    coinPublicKey: string,
  ) {
    this.state = state;
    this.privateState = privateState;
    this.coinPublicKey = coinPublicKey;
  }

  /** Runs the constructor and returns a simulation of the deployed contract. */
  static async deploy<C extends SimContract<PS>, PS, L>(opts: DeployOptions<C, PS, L>): Promise<Sim<C, PS, L>> {
    const coinPublicKey = opts.coinPublicKey ?? SIM_COIN_PUBLIC_KEY;
    const args = (opts.args ?? []) as never[];
    const result = await opts.contract.initialState(createConstructorContext(opts.privateState, coinPublicKey), ...args);
    return new Sim(opts.contract, opts.ledger, result.currentContractState.data, result.currentPrivateState, coinPublicKey);
  }

  /** Makes later calls come from this coin public key (hex). */
  as(coinPublicKey: string): this {
    this.coinPublicKey = coinPublicKey;
    return this;
  }

  /**
   * Calls an impure circuit as one transaction. On success the public and
   * private state move forward; if the circuit throws (a failed assert), the
   * error propagates and neither changes.
   */
  async call<K extends CircuitName<C>>(
    circuit: K,
    ...args: CircuitArgs<C, K>
  ): Promise<{ result: CircuitResult<C, K>; ledger: L }> {
    const fn = (this.contract.impureCircuits as Record<string, unknown>)[circuit];
    if (typeof fn !== 'function') throw new Error(`${circuit} is not an impure circuit of this contract`);
    const context = createCircuitContext<PS>({
      circuitId: circuit,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: this.coinPublicKey,
      contractState: this.state,
      privateState: this.privateState,
    });
    const out = await (
      fn as (ctx: CircuitContext<PS>, ...a: unknown[]) => Promise<CircuitResults<PS, CircuitResult<C, K>>>
    ).call(this.contract.impureCircuits, context, ...args);
    this.state = out.context.callContext.currentQueryContext.state;
    this.privateState = out.context.callContext.currentPrivateState as PS;
    this.lastContext = out.context;
    return { result: out.result, ledger: this.decode(this.state) };
  }

  /** The decoded public ledger, as an indexer would show it. */
  ledger(): L {
    return this.decode(this.state);
  }
}

/**
 * Runs `fn` and returns the error it throws. Fails if it doesn't throw, or if
 * `message` is given and the error message doesn't contain it. Use it for
 * every guard: `await expectRejects(() => sim.call('withdraw', ...), 'not the owner')`.
 */
export async function expectRejects(fn: () => unknown, message?: string): Promise<Error> {
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  if (thrown === undefined) throw new Error(`expected a rejection${message ? ` containing "${message}"` : ''}, but the call succeeded`);
  const err = thrown instanceof Error ? thrown : new Error(String(thrown));
  if (message !== undefined && !err.message.includes(message)) {
    throw new Error(`expected a rejection containing "${message}", got: ${err.message}`);
  }
  return err;
}

// ---------------------------------------------------------------------------

// Privacy checks over a decoded public ledger.
//
// Replaces the hand-written collect…Bytes / findLeak pairs that were in
// examples/shielded-chips/src/test/privacy.test.ts and
// examples/private-tip-jar/src/test/private-tip-jar.test.ts. The walker
// follows the ledger itself, so a new ledger field is covered without
// editing a list.

/** One byte string found in public state, with the path it was found at. */
export interface PublicBytes {
  label: string;
  bytes: Uint8Array;
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

const isIterable = (v: object): v is Iterable<unknown> =>
  typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';

/**
 * Collects every byte string in a decoded ledger (the object `ledger(state)`
 * returns, or anything shaped like it): plain fields, struct fields, and the
 * entries of Map, Set and List ADTs. Map entries are labelled
 * `field[i].key` / `field[i].value`; Set and List entries `field[i]`.
 */
export function collectPublicBytes(ledger: unknown, root = ''): PublicBytes[] {
  const out: PublicBytes[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, label: string): void => {
    if (v instanceof Uint8Array) {
      out.push({ label, bytes: v });
      return;
    }
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${label}[${i}]`));
      return;
    }
    if (isIterable(v)) {
      // A Map ADT has lookup() and yields [key, value] pairs.
      const isMap = typeof (v as { lookup?: unknown }).lookup === 'function';
      let i = 0;
      for (const entry of v) {
        if (isMap && Array.isArray(entry) && entry.length === 2) {
          walk(entry[0], `${label}[${i}].key`);
          walk(entry[1], `${label}[${i}].value`);
        } else {
          walk(entry, `${label}[${i}]`);
        }
        i++;
      }
      return;
    }
    for (const key of Object.keys(v)) {
      const field = (v as Record<string, unknown>)[key];
      if (typeof field === 'function') continue;
      walk(field, label ? `${label}.${key}` : key);
    }
  };
  walk(ledger, root);
  return out;
}

/**
 * Returns the label of the first public byte string that contains `secret`,
 * or null. Containment, not equality: a secret embedded in a larger field
 * (a struct encoded as bytes, a padded value) still counts as a leak.
 */
export function findInPublicState(ledger: unknown, secret: Uint8Array): string | null {
  const target = hex(secret);
  if (target.length === 0) return null;
  for (const { label, bytes } of collectPublicBytes(ledger)) {
    if (hex(bytes).includes(target)) return label;
  }
  return null;
}

/**
 * Throws if any secret appears anywhere in the decoded ledger, naming the
 * secret and the field it was found in. `secrets` maps a name (used in the
 * message) to its bytes; write one entry per "never on chain" line of the
 * example's SPEC.md.
 */
export function assertNotInPublicState(ledger: unknown, secrets: Record<string, Uint8Array>): void {
  const leaks: string[] = [];
  for (const [name, bytes] of Object.entries(secrets)) {
    const field = findInPublicState(ledger, bytes);
    if (field !== null) leaks.push(`${name} found in public state at ${field}`);
  }
  if (leaks.length > 0) throw new Error(`privacy invariant broken:\n  ${leaks.join('\n  ')}`);
}
