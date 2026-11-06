// @vitest-environment node
//
// Runs the real compiled hello-world contract in memory (no network, no
// proofs) to produce actual on-chain state values, then checks that message$
// decodes them the way the UI displays them.
import { describe, expect, it } from "vitest";
import { firstValueFrom, of, toArray } from "rxjs";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { Contract } from "../midnight/contract";
import { message$ } from "../midnight/hello-world-api";
import type { HelloWorldProviders } from "../midnight/providers";

const COIN_PK = "00".repeat(32);

describe("message$", () => {
  it("decodes the on-chain message before and after storeMessage", async () => {
    const contract = new Contract({});
    const { currentContractState } = await contract.initialState(createConstructorContext({}, COIN_PK));

    const ctx = createCircuitContext({
      circuitId: "storeMessage",
      contractAddress: dummyContractAddress(),
      coinPublicKeyOrZswapState: COIN_PK,
      contractState: currentContractState,
      privateState: {},
    });
    const { context } = await contract.impureCircuits.storeMessage(ctx, "Hello World!");

    // Minimal stand-in for the indexer: emit the two states in order, as
    // Midnight.js 5 serves them (an era-tagged state that decodes on demand).
    const read = (state: { data: unknown }) => ({
      contractState: { era: "v9", deserialize: () => state },
    });
    const providers = {
      publicDataProvider: {
        contractStateObservable: () =>
          of(
            { value: read(currentContractState) },
            { value: read({ data: context.callContext.currentQueryContext.state }) },
          ),
      },
    } as unknown as HelloWorldProviders;

    const seen = await firstValueFrom(message$(providers, "addr").pipe(toArray()));
    expect(seen).toEqual(["", "Hello World!"]);
  });
});
