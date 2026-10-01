// L1: run a compiled contract in memory, with no network, proofs or keys.
//
// This is the compact-runtime 0.20 version of mn-examples' zk-loan simulator
// (examples/zk-loan/src/test/zk-loan.simulator.ts). 0.20 changed
// createCircuitContext from positional parameters to one CircuitContextOptions
// object (toolchain-0.35.0 notes, "Breaking"), and circuits are now async.
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type ChargedState,
  type CircuitContextOptions,
  type ContractAddress,
  type ContractState,
} from '@midnight-ntwrk/compact-runtime';

// A fixed 32-byte coin public key for the simulated caller.
export const SIM_COIN_PK = '11'.repeat(32);

type ImpureCircuit<PS> = (ctx: any, ...args: any[]) => Promise<{ result: unknown; context: any }>;
interface SimContract<PS> {
  impureCircuits: Record<string, ImpureCircuit<PS>>;
  initialState(ctx: any, ...args: any[]): Promise<{ currentContractState: ContractState; currentPrivateState: PS }>;
}

export class Simulator<PS> {
  private constructor(
    private readonly contract: SimContract<PS>,
    readonly address: ContractAddress,
    /** The contract's ledger state; pass it to the generated `ledger()`. */
    public state: ChargedState,
    public privateState: PS,
    private readonly extra: Partial<CircuitContextOptions<PS>>,
  ) {}

  static async deploy<PS>(
    contract: SimContract<PS>,
    privateState: PS,
    args: unknown[],
    extra: Partial<CircuitContextOptions<PS>> = {},
  ): Promise<Simulator<PS>> {
    const init = await contract.initialState(createConstructorContext(privateState, SIM_COIN_PK), ...args);
    // The constructor returns a ContractState; circuits and `ledger()` work on
    // its ChargedState `data`.
    return new Simulator(contract, sampleContractAddress(), init.currentContractState.data, init.currentPrivateState, extra);
  }

  /**
   * The full circuit context of the last successful call. After a
   * cross-contract call, `queryContexts[calleeAddress].state` holds the
   * callee's ledger as the call left it.
   */
  lastContext: any;

  /** Runs one circuit; on success the ledger and private state move forward. */
  async call<R = unknown>(circuitId: string, ...args: unknown[]): Promise<R> {
    const circuit = this.contract.impureCircuits[circuitId];
    if (!circuit) throw new Error(`no impure circuit ${circuitId}`);
    const ctx = createCircuitContext<PS>({
      circuitId,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: SIM_COIN_PK,
      contractState: this.state,
      privateState: this.privateState,
      ...this.extra,
    });
    const { result, context } = await circuit(ctx, ...args);
    this.lastContext = context;
    this.state = context.callContext.currentQueryContext.state;
    this.privateState = context.callContext.currentPrivateState;
    return result as R;
  }
}

/** What a call did: returned a value, or was refused before/while running. */
export type Outcome<T> = { kind: 'value'; value: T } | { kind: 'rejected'; message: string };

export async function outcome<T>(fn: () => T | Promise<T>): Promise<Outcome<T>> {
  try {
    return { kind: 'value', value: await fn() };
  } catch (e) {
    return { kind: 'rejected', message: e instanceof Error ? e.message : String(e) };
  }
}
