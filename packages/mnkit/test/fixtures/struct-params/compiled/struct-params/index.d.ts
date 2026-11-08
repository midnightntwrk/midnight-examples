import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Limits = { min: bigint; max: bigint };

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  setLimits(context: __compactRuntime.CircuitContext<PS>, cfg_0: Limits): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  setLimits(context: __compactRuntime.CircuitContext<PS>, cfg_0: Limits): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  setLimits(context: __compactRuntime.CircuitContext<PS>, cfg_0: Limits): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type Ledger = {
  readonly limits: Limits;
  readonly color: Uint8Array;
  readonly window: { start: bigint, end: bigint };
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               cfg_0: Limits,
               w_0: { start: bigint, end: bigint },
               coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
               owner_0: Uint8Array): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;
