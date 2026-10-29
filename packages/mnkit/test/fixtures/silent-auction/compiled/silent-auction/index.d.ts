import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum AuctionState { CLOSED = 0, OPEN = 1, RECEIVE = 2, PAID = 3 }

export type Witnesses<PS> = {
  localSk(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  receiveTokens(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  bid(context: __compactRuntime.CircuitContext<PS>, bidAmount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealWin(context: __compactRuntime.CircuitContext<PS>, minPrice_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claimWin(context: __compactRuntime.CircuitContext<PS>,
           winnerAddress_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  receiveTokens(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  bid(context: __compactRuntime.CircuitContext<PS>, bidAmount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealWin(context: __compactRuntime.CircuitContext<PS>, minPrice_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claimWin(context: __compactRuntime.CircuitContext<PS>,
           winnerAddress_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  receiveTokens(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  bid(context: __compactRuntime.CircuitContext<PS>, bidAmount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealWin(context: __compactRuntime.CircuitContext<PS>, minPrice_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claimWin(context: __compactRuntime.CircuitContext<PS>,
           winnerAddress_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly auctionOrganizer: Uint8Array;
  readonly hiddenPrice: Uint8Array;
  readonly maxBids: bigint;
  readonly depositAmount: bigint;
  readonly publicPrice: bigint;
  bidders: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  readonly highestBid: bigint;
  readonly auctionState: AuctionState;
  readonly nftType: Uint8Array;
  readonly organizerAddress: { bytes: Uint8Array };
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
               _minPrice_0: bigint,
               maxBidCount_0: bigint,
               address_0: { bytes: Uint8Array }): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
