// In-memory deploy-and-call harness for a compiled Compact contract.
//
// Runs the compiler's JS output (contract/managed/<c>/contract/index.js) with
// compact-runtime, so it needs no proof server, node or indexer. Proving keys
// aren't used either: `yarn compile:fast` (--skip-zk) output is enough.
//
// Each call() is its own transaction: a fresh circuit context built from the
// current public state, the current private state and the caller's coin
// public key, the way examples/calculator/ui/src/__tests__/
// calculator-circuits.test.ts does it.

import {
  type ChargedState,
  type CircuitContext,
  type CircuitResults,
  type ConstructorContext,
  type ConstructorResult,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

/** Coin public key used when the test doesn't pick one (hex, 32 bytes). */
export const SIM_COIN_PUBLIC_KEY = '00'.repeat(32);

/** The parts of a compiler-generated `Contract<PS>` the harness uses. */
export interface SimContract<PS> {
  initialState(context: ConstructorContext<PS>, ...args: never[]): ConstructorResult<PS>;
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
  ReturnType<CircuitFn<C, K>> extends CircuitResults<unknown, infer R> ? R : never;
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
  static deploy<C extends SimContract<PS>, PS, L>(opts: DeployOptions<C, PS, L>): Sim<C, PS, L> {
    const coinPublicKey = opts.coinPublicKey ?? SIM_COIN_PUBLIC_KEY;
    const args = (opts.args ?? []) as never[];
    const result = opts.contract.initialState(createConstructorContext(opts.privateState, coinPublicKey), ...args);
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
  call<K extends CircuitName<C>>(circuit: K, ...args: CircuitArgs<C, K>): { result: CircuitResult<C, K>; ledger: L } {
    const fn = (this.contract.impureCircuits as Record<string, unknown>)[circuit];
    if (typeof fn !== 'function') throw new Error(`${circuit} is not an impure circuit of this contract`);
    const context = createCircuitContext(this.address, this.coinPublicKey, this.state, this.privateState);
    const out = (fn as (ctx: CircuitContext<PS>, ...a: unknown[]) => CircuitResults<PS, CircuitResult<C, K>>).call(
      this.contract.impureCircuits,
      context,
      ...args,
    );
    this.state = out.context.currentQueryContext.state;
    this.privateState = out.context.currentPrivateState;
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
 * every guard: `expectRejects(() => sim.call('withdraw', ...), 'not the owner')`.
 */
export function expectRejects(fn: () => unknown, message?: string): Error {
  let thrown: unknown;
  try {
    fn();
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
