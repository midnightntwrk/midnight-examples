# Compact gotchas: read before writing a contract

The rules that the examples in this repo learned the hard way. Every one is
backed by an example that runs in CI or by a devnet audit, and each links to
its source for the full story. Read this file, [`patterns.md`](patterns.md) and
the example closest to your use case; you don't need the long tutorials to
start. The pinned toolchain is in the [README](../README.md#pinned-toolchain-phase-1-baseline) — don't
trust recalled APIs over it.

## What goes on chain

- **Ledger writes publish; `disclose()` does not.** `disclose(x)` tells the
  compiler you accept that a witness-derived value crosses a trust boundary.
  The value is only published if it's written to the ledger or recorded in an
  effect. To find out what is public, read the contract state, not the
  `disclose` calls. ([LESSONS §4](../examples/shielded-chips/LESSONS.md#4-primitive-level-facts-worth-memorizing))
- **Witness-derived values need `disclose()`** before they're stored or
  returned. ([calculator](../examples/calculator/AGENTS.md))
- **A circuit that never touches the ledger compiles with `proof: false`**:
  it has no ZK key and you can't submit it with `submitCallTx`. `divide` writes
  `result` for this reason. ([calculator](../examples/calculator/AGENTS.md))
- **Circuit arguments are not published, but circuit names are.** The indexer
  exposes `entryPoint`, so *which* action a key took is always public.
  ([LESSONS §4](../examples/shielded-chips/LESSONS.md#4-primitive-level-facts-worth-memorizing))
- **Compiling and passing tests prove nothing about privacy.** Every leaky
  version of shielded-chips compiled and passed. Assert on the public state:
  read the ledger back and check that no secret appears in it
  ([`privacy.test.ts`](../examples/shielded-chips/src/test/privacy.test.ts)).
  ([LESSONS §10](../examples/shielded-chips/LESSONS.md#10-process-notes))

## Identity and commitments

- **Identity comes from a witness secret.** The pattern is
  `persistentHash([pad(32, "<app>:pk:"), sk])`. Add `kernel.self()` to the hash
  so the same secret gives an unlinkable key in each deployment.
  ([private-bid](../examples/private-bid/contract/private-bid.compact), [LESSONS §6](../examples/shielded-chips/LESSONS.md#6-patterns-that-didnt))
- **Use one secret per job.** If identity, mint authority and blinding share
  one `sk`, then opening any commitment gives away the rest.
  ([LESSONS §6](../examples/shielded-chips/LESSONS.md#6-patterns-that-didnt))
- **Salt any commitment to a guessable value.** A hash of a vote or a price
  can be brute-forced; `persistentCommit(value, salt)` with a secret salt
  can't. ([private-bid `placeBid`](../examples/private-bid/contract/private-bid.compact), [election `commitWithSk`](../examples/election/contract/election.compact))
- **Narrowing casts fail at run time.** `amount as Uint<16>` rejects values
  above 65535 even when `amount` is a `Uint<64>`. Size counters for their real
  range. ([LESSONS §4](../examples/shielded-chips/LESSONS.md#4-primitive-level-facts-worth-memorizing))

## Shielded tokens (only if you use them)

- **Never write a user's coin nonce to public state.** It links the coin to
  the wallets that funded it and were paid from it. Store
  `persistentCommit([nonce, color, value], salt)` and reopen it from a
  witness. ([LESSONS §1](../examples/shielded-chips/LESSONS.md#1-the-one-rule))
- **A coin the contract received in this transaction** (`receiveShielded`)
  has no tree index yet and is spent as a zswap transient, with `mt_index: 0`.
  `sendImmediateShielded` is exactly `sendShielded` with `mt_index: 0`, so
  either form works; prefer `sendImmediateShielded` because it states intent.
  **A coin already in the tree** needs `sendShielded` with its real
  `mt_index`: the index is not checked in the circuit, but the SDK uses it to
  build the Merkle path, so a wrong one fails when the transaction is built
  or applied.
  ([stdlib 0.31.1](https://github.com/LFDT-Minokawa/compact/blob/compactc-v0.31.1/compiler/standard-library.compact#L199-L205),
  [zswap transients](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.2/zswap/src/construct.rs#L386-L412),
  [TUTORIAL cheat-sheet](../examples/shielded-chips/TUTORIAL.md#shielded-token-cheat-sheet))
- **`sendShielded` and `mergeCoin` derive the output nonce from the input
  nonce alone** (`mergeCoin` from its *first* argument), so the argument order
  decides what can be linked. ([LESSONS §5](../examples/shielded-chips/LESSONS.md#5-patterns-that-worked))
- **Mint amounts are public; transfer amounts are not.** Recipients are
  `left(walletKey)` or `right(kernel.self())`.
  ([TUTORIAL privacy rules](../examples/shielded-chips/TUTORIAL.md#privacy-rules-in-one-place))

## Harness and tests

- **Failing `assert`s are rejected locally**, before proving and before
  anything is submitted. That makes negative tests cheap, so write one for
  every guard. ([private-bid](../examples/private-bid/AGENTS.md), [zk-loan](../examples/zk-loan/AGENTS.md))
- **`contract/witnesses.ts` runs in the browser too.** Don't import `node:*`
  in it; `new:ui` refuses if you do. ([battleship](../examples/battleship/AGENTS.md))
- **`submitTransaction` resolves when the transaction is accepted, not when
  it's included.** Wait for the balance or state before the next step.
  ([LESSONS §5](../examples/shielded-chips/LESSONS.md#5-patterns-that-worked))
- **A synced wallet isn't necessarily funded.** Tests need `yarn wait:dust`
  first (`yarn validate` runs it).
- **Tests that share a wallet can't run in parallel.** Set
  `fileParallelism: false` when there's more than one test file.
  ([shielded-chips `vitest.config.ts`](../examples/shielded-chips/vitest.config.ts), [root AGENTS.md](../AGENTS.md#golden-rules))
- **Don't bump `@midnight-ntwrk/*` or the compiler for one example.** Version
  changes are a repo-wide pass. ([root AGENTS.md](../AGENTS.md#golden-rules))
