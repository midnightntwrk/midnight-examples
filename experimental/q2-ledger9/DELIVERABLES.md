# Deliverable status report

Status of seven deliverables, judged **only** by what the test suites in this
repo demonstrate against **live stagenet** with **compactc 0.33.0-rc.2** and the
`5.0.0-beta.4` midnight-js / `1.0.0-rc.3` ledger stack.

Evidence tiers used below:
- **Verified E2E** — compiled to a *provable* circuit (real prover/verifier keys,
  not `--skip-zk`), deployed + called on stagenet, real ZK proof accepted, and
  on-chain state asserted (node post-call state and/or indexer read-back).
- **Compile-gap** — does not compile on rc.2; the suite SKIPS behind a GAP banner
  and runs unchanged once the upstream gap clears.

Every secp256k1/keccak circuit is gated behind the **`--feature-zkir-v3`** compiler
flag (wired per-contract in `scripts/compile.mts`); without it the secp256k1
surface is unbound.

| # | Deliverable | Status | Evidence (suite) |
|---|-------------|--------|------------------|
| 1 | Native Crypto Primitives (USDCx hashing) | ✅ **Delivered** | `usdcx` — 3/3 E2E |
| 2 | ECDSA Signature Support | ⚠️ **Partial** — verify yes, recover no | `verify-sequential-secp` 4/4, `usdcx` 3/3; `recover-secp` SKIP |
| 3 | Contract-to-contract calls | ✅ **Delivered** (data-flow CCC); ⚠️ caller-identity/self-call variants gap | `no-witness-dex` 2/2, `uniswap` 4/4; `caller`/`axelar`/`self-recursion` SKIP |
| 4 | ZKIRv3 | ✅ **Delivered** | enables 1,2,5,6; all secp256k1 dapps provable + verified on stagenet |
| 5 | Native Keccak hashing | ✅ **Delivered** | `eth-addr-secp` 3/3, `usdcx` 3/3 |
| 6 | Native secp256k1 | ⚠️ **Partial** — verify/address/point yes, recover no | `eth-addr-secp` 3/3, `verify-sequential-secp` 4/4; `recover-secp` SKIP |
| 7 | Events | ✅ **Delivered** | `events` 2/2 |

---

## 1. Native Crypto Primitives (USDCx hashing) — ✅ Delivered

The full `BridgedUsdcMint` (USDCx / CCTP) contract compiles **from source** on rc.2
(`--feature-zkir-v3`) to a provable circuit and passes end-to-end on stagenet:
deploy with two attester addresses, `receiveAndMint` from a third-party relayer
(real mint proof), and rejection of an attestation replay. This exercises the
crypto primitives USDCx depends on — `keccak256` over `Bytes<376>`, `concatBytes`,
`Bytes<N>` ordering, and ECDSA verification against supplied pubkeys — as one
working pipeline. (`src/test/usdcx.test.ts`, 3/3.)

Note: this superseded an earlier assumption that USDCx needed a shipped prebuilt
artifact; the only blocker was the missing `--feature-zkir-v3` flag.

## 2. ECDSA Signature Support — ⚠️ Partial (verification delivered, recovery absent)

- **Verification — delivered.** `secp256k1EcdsaVerify` works, including **multiple
  instantiations in a single circuit**: `verify-sequential-secp` runs 2× and 3×
  sequential verifies over one digest and increments a counter, and a mismatched
  signature correctly aborts the circuit (`assert "b0"`). usdcx additionally
  verifies signatures against registered attester pubkeys. (`verify-sequential-secp`
  4/4, `usdcx` 3/3, E2E.)
- **Recovery — absent.** `secp256k1EcdsaRecover` + `Secp256k1EcdsaSignatureWithRecovery`
  were removed between rc.0 and rc.1 and are **still unbound in rc.2** even with the
  flag. `recover-secp` is a compile-gap regression guard (SKIPS today; runs when
  restored). (`src/test/recover-secp.test.ts`.)

## 3. Contract-to-contract calls — ✅ Delivered (data-flow); ⚠️ identity/self-call variants gap

- **Cross-contract data flow — delivered.** Both `no-witness-dex` (token_a → DEX →
  token_b swap) and `uniswap` (`DEX.swap` pulling from token reserves) execute their
  cross-contract calls **green on stagenet** with full balance/reserve deltas and
  supply-conservation verified — **zero** "callee-state gap" fallbacks. uniswap also
  confirms a genuinely re-entrant path (`MyToken→DEX→MyToken`) is correctly rejected.
  (`no-witness-dex` 2/2, `uniswap` 4/4, E2E.)

  > Notable: the callee-state-resolution gap that was RED on the local devnet branch
  > stack does **not** reproduce on stagenet.
- **Caller-identity / self-call variants — gap.** `caller` (needs `kernel.caller`),
  `axelar-gateway` and `self-recursion` (self-interface types) don't compile on rc.2.
  These are distinct compiler features, not the CCC data-flow path above.
  (SKIP suites.)

## 4. ZKIRv3 — ✅ Delivered

`--feature-zkir-v3` is the enabler for the entire secp256k1/keccak surface, and the
ZKIR-v3 lowering is sound for these circuits: every secp256k1 dapp (usdcx,
eth-addr-secp, verify-sequential-secp) compiles to **provable** circuits (prover +
verifier keys) and produces proofs the stagenet node accepts. `eth-addr-secp`
specifically depends on the ZKIR-v3 curve-point alignment fix (compact#612) that
made keccak-over-a-curve-point lowerable. No ZKIR-v3 lowering failures were observed
across any provable circuit built here.

## 5. Native Keccak hashing — ✅ Delivered

Native `keccak256` is proven by exact output match, not just "it ran":
`eth-addr-secp` asserts the in-circuit `secp256k1EthereumAddress` (keccak256 over the
recovered point encoding, last 20 bytes) equals the off-chain `keccak256(pubkey)[12:]`
— they matched on stagenet. usdcx independently recomputes `keccak256` over the
376-byte CCTP message in-circuit, and the mint only succeeds if that digest matches.
(`eth-addr-secp` 3/3, `usdcx` 3/3, E2E.)

## 6. Native secp256k1 — ⚠️ Partial (verify / address / point delivered, recover absent)

Delivered and proven on stagenet: the `Secp256k1Point` type, the
`Secp256k1EcdsaSignature {r,s}` struct, `secp256k1EcdsaVerify`, and
`secp256k1EthereumAddress`. Absent: the recovery API (`secp256k1EcdsaRecover` /
`Secp256k1EcdsaSignatureWithRecovery`) — see #2. Point arithmetic
(`secp256k1Add/Mul`, `secp256k1PointX/Y`) exists in the runtime surface but is **not
independently exercised** by a suite here (only used transitively).

## 7. Events — ✅ Delivered

`Events.transfer` emits `UnshieldedSpend` + `UnshieldedReceive` via the `log`
statement; the suite verifies both read paths — ledger-state balance deltas and the
contract-log events themselves, read back over the indexer `contractEvents` GraphQL
API and asserted to be exactly 2 on the transfer tx. (`src/test/events.test.ts`, 2/2.)

---

## Coverage gaps / caveats

- All secp256k1 results are **conditional on `--feature-zkir-v3`** (opt-in, off by
  default in rc.2).
- ECDSA correctness coverage is **verification-focused**: valid single/multi verify +
  one tampered-signature rejection. Not probed: signature malleability, non-canonical
  `s`, off-curve/identity points.
- secp256k1 low-level point arithmetic is not directly asserted by any suite.
- The recover-path and caller-identity/self-interface deliverables are tracked as
  live compile-gap guards, not passing tests.
