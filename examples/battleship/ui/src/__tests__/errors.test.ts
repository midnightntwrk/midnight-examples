import { describe, expect, it } from "vitest";
import { errorMessage } from "../lib/errors";

describe("errorMessage", () => {
  it("unwraps a wallet Effect FiberFailure (empty top-level message)", () => {
    // Shape captured from Lace's balanceUnsealedTransaction on an unfunded wallet.
    const err = Object.assign(new Error(""), {
      _id: "FiberFailure",
      cause: {
        _id: "Cause",
        _tag: "Fail",
        failure: {
          message: "Insufficient Funds: could not balance dust",
          tokenType: "dust",
          _tag: "Wallet.InsufficientFunds",
        },
      },
    });
    const msg = errorMessage(err, "fallback");
    expect(msg).toContain("Insufficient Funds: could not balance dust");
    expect(msg).toContain("needs DUST");
  });

  it("formats DApp Connector errors", () => {
    expect(
      errorMessage({ type: "DAppConnectorAPIError", code: "Rejected", reason: "User rejected" }, "x"),
    ).toBe("User rejected (Rejected)");
  });

  it("points a failed fetch at the indexer", () => {
    for (const message of ["Failed to fetch", "Load failed"]) {
      const msg = errorMessage(new TypeError(message), "x");
      expect(msg).toContain(message);
      expect(msg).toContain("VITE_INDEXER_URI");
    }
    expect(errorMessage(new Error("Failed to fetch zk config"), "x")).toBe("Failed to fetch zk config");
  });

  it("follows Error.cause and falls back when nothing is readable", () => {
    expect(errorMessage(new Error("", { cause: new Error("inner") }), "x")).toBe("inner");
    expect(errorMessage({}, "fallback")).toBe("fallback");
  });
});
