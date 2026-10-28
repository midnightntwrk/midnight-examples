import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum PartyState { NOT_STARTED = 0,
                         READY = 1,
                         STARTED = 2,
                         DOORS_CLOSED = 3,
                         FEES_CLAIMED = 4
}

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  rsvp(context: __compactRuntime.CircuitContext<PS>,
       _address_0: { bytes: Uint8Array },
       _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  startParty(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  checkIn(context: __compactRuntime.CircuitContext<PS>,
          address_0: { bytes: Uint8Array },
          _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeEntry(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimFees(context: __compactRuntime.CircuitContext<PS>,
            address_0: { bytes: Uint8Array },
            _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  rsvp(context: __compactRuntime.CircuitContext<PS>,
       _address_0: { bytes: Uint8Array },
       _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  startParty(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  checkIn(context: __compactRuntime.CircuitContext<PS>,
          address_0: { bytes: Uint8Array },
          _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeEntry(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimFees(context: __compactRuntime.CircuitContext<PS>,
            address_0: { bytes: Uint8Array },
            _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  rsvp(context: __compactRuntime.CircuitContext<PS>,
       _address_0: { bytes: Uint8Array },
       _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  startParty(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  checkIn(context: __compactRuntime.CircuitContext<PS>,
          address_0: { bytes: Uint8Array },
          _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeEntry(context: __compactRuntime.CircuitContext<PS>, _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimFees(context: __compactRuntime.CircuitContext<PS>,
            address_0: { bytes: Uint8Array },
            _secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly organizer: Uint8Array;
  readonly maxListSize: bigint;
  readonly entryFee: bigint;
  readonly partyState: PartyState;
  hashedPartyGoers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  checkedInParty: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: { bytes: Uint8Array }): boolean;
    [Symbol.iterator](): Iterator<{ bytes: Uint8Array }>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               partySize_0: bigint,
               fee_0: bigint,
               _secret_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
