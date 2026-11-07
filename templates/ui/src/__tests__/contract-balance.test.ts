// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCircuitContext,
  dummyContractAddress,
  StateValue,
} from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { nativeToken } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { withUnshieldedBalance } from "./contract-balance";

describe("withUnshieldedBalance", () => {
  it("sets the contract's NIGHT balance on the call context", () => {
    const ctx = createCircuitContext({
      circuitId: "anyCircuit",
      contractAddress: dummyContractAddress(),
      coinPublicKeyOrZswapState: "00".repeat(32),
      contractState: StateValue.newNull(),
      privateState: {},
    });
    expect(ctx.callContext.currentQueryContext.block.balance.size).toBe(0);
    withUnshieldedBalance(ctx, 42n);
    expect([...ctx.callContext.currentQueryContext.block.balance]).toEqual([[nativeToken(), 42n]]);
  });
});
