# AGENTS.md — voting

**Verified against:** Compact language `0.28`, compiler `0.36.0`,
`@midnight-ntwrk/midnight-js-*` `5.0.0`, wallet SDK `2.0.0`, Node 22.

## What it teaches

- **Anonymous allow-list.** A `MerkleTree<10, Bytes<32>>` holds the enrolled
  voter keys. `cast` proves membership in zero knowledge:
  - it calls `voters.checkRoot(disclose(merkleTreePathRoot(path)))`;
  - it asserts that `path.leaf` is the caller's own key. Without that check, an
    outsider could replay a member's public path.
  - The `voterPath` witness finds the path with `ledger.voters.findPathForLeaf(pk)`
    in the state the circuit runs against.
- **Instance-bound nullifiers.** `ballotNullifier(sk, proposalId, kernel.self().bytes)`
  stops double votes. Because it includes the proposal id and the contract
  address, the same voter's ballots in different votes can't be linked. That holds
  even for two deployments with the same label. `ballotSalt` is bound the same
  way, and so is the ballot blob's associated data.
- **A ballot in one transaction.**
  - `cast` stores a hiding `persistentCommit(vote, salt)`. The salt comes from
    the voter's secret, so the voter only ever backs up one key.
  - It also stores an `Opaque<"Uint8Array">` blob that the client encrypts off
    chain to every admin key published in `adminEncKeys`.
  - `cast` also takes the keys the blob is sealed to (`Vector<8>`, zero-padded)
    and checks each is in `adminEncKeys`. The keys come from the indexer, so a
    made-up key fails against the real state. The CLI also requires the
    announced admin key set fingerprint (`--admin-keys`) before sealing.
  - The client side is in `src/crypto.ts`: X25519, HKDF-SHA256 and
    XChaCha20-Poly1305 from `@noble/*`. The header, proposal id and contract
    address are the associated data.
  - The circuit can't tie the blob to the commitment. The admin checks every
    decrypted opening with the pure `ballotCommit` before calling `count`, so one
    lying blob can't stall the count.
- **Counting the admin can't fake.**
  - `count(n, vote, salt)` has no caller check and only accepts an opening that
    matches the commitment.
  - The admin can decrypt and count, but can't change a vote.
  - A voter can rebuild their own opening from their secret and count it if the
    admin skips it, or if their blob was bad.
- **Block-time rules.**
  - `blockTimeLt(deadline)` gates `cast`.
  - `blockTimeGte(deadline)`, or an early close, opens `count`.
  - `closeEarly()` only starts counting early. `countingEnds` stays at
    deadline + 48h, so the admin can't shorten a voter's self-count window.
- **An admin/voter CLI.** `scripts/cli.ts` is run with `npm run vote`. It builds
  on the scaffold's `scripts/deploy.ts` and `deployments/<network>.json`.

## Layout

- `SPEC.md`: the design card (roles, public fields, circuits and asserts,
  privacy invariants, accepted leaks). Keep it in step with the code.
- `contract/voting.compact` (committed), `contract/index.ts`
  (+ `contract/witnesses.ts` when the contract declares witnesses).
- `src/crypto.ts`: key derivation through the contract's pure circuits, and
  ballot sealing and opening. `src/keys.ts`: the CLI's key files.
- `scripts/cli.ts`: the admin/voter CLI (`npm run vote -- <command>`).
- `src/test/voting.sim.test.ts`: in-memory tests (every guard, deadlines with
  a simulated block time, the fallback count, the privacy invariants).
  `src/test/crypto.sim.test.ts`: tests for ballot sealing.
  `src/test/voting.test.ts`: the devnet suite (the end-to-end flow, with
  concurrent casts from two wallets).
- `src/test/sim.ts` is the shared in-memory harness, plus `Sim.at(unixSecs)`,
  which sets the block time the next calls see.

## Run

```bash
npm run compile:fast && npm run typecheck && npm run test:sim  # seconds, no Docker
npm run validate                                               # compile, env:up, wait:dust, test:local, env:down
```

Or, from the repo root, `npm run pipeline -- voting [--json]`: it runs the next
scripts and gates (spec lint, compile:fast, --derive, typecheck, test:sim,
the SPEC code checks, compile, the UI) with the devnet in the background, and
prints what to do next.

`npm run validate` exits non-zero if any step fails, and always takes the network
down. While fixing tests, `npm run validate -- --keep-net` leaves the network up so
the next run skips the restart. Step by step:

```bash
npm run env:up && npm run wait:dust
npm run test:local
npm run env:down
```

To deploy outside the tests (a contract the UI or a teammate joins), run
`npm run deploy` (local), `npm run deploy:preview` or `npm run deploy:preprod`. It
deploys with `contract/deploy-args.ts` and records the address in
`deployments/<network>.json`.

## Notes for agents

- The admin's secret and each voter's secret go through the same `secretKey`
  witness. Who is calling is decided by the private state in use
  (`createVotingPrivateState(sk, vote?)`), not by the wallet. A test or the CLI
  sets the private state before every call.
- `cast` writes nothing that names the voter. Don't add `ownPublicKey()`, an
  unshielded input or output, or a disclosed `pk` to it: any of them breaks
  ballot anonymity.

- A browser UI is phase 2. Once the in-memory gate passes (`npm run typecheck`,
  `npm run test:sim`, `npm run spec:lint voting`), run `npm run new:ui voting` from
  the repo root, or let `npm run pipeline voting` do it, then build the use case
  into its seed files. The devnet must still pass before the UI is done. See
  `packages/mnkit/templates/ui/AGENTS.md`.

- `contract/managed/` is generated by `npm run compile` (or `npm run compile:fast`,
  without proving keys) and gitignored. The TS harness imports from it, so
  nothing type-checks until you have compiled at least once.
- After a contract change, or a change to `createVotingPrivateState`'s
  parameters, run `npm run compile:fast` then, from the repo root,
  `npm run new:example -- voting --derive`. It refreshes the `@generated-stub`
  regions nobody has edited (new circuits, constructor parameters, witnesses,
  the initial private state in both tests and in `contract/deploy-args.ts`)
  and leaves the rest alone.
- Shielded coins in tests come from `src/test/coins.ts`. A
  `ShieldedCoinInfo` argument (a tip, a bet, a deposit: anything the circuit
  `receiveShielded`s) is a new coin the
  transaction creates, not one of the wallet's coins. Pass
  `freshCoin(color, value)`, which has a random nonce. The wallet pays for it
  from whichever coins it selects and makes change, so any amount works and
  no split comes first. Never build it from the wallet's `availableCoins`: that
  nonce is shared with your wallet coin and known to whoever minted it. If the
  contract keys a map by the coin's nonce, have it refuse a nonce already
  present. If it keeps the coin off chain instead (only a commitment), the
  depositor needs the coin's tree index to spend it later:
  `contractCoinMtIndex(indexer, tx.public, coin, contractAddress)`. Use `tokenColor(domain, mintingContract)` for colors, and
  `shieldedBalance` / `waitForShieldedBalance` (a received coin shows up
  seconds after the transaction is accepted). For a mint, use `recipientOf`,
  `encryptionKeys` and `mintNonce`. In a sim test, `simCoin(value, color)`
  makes a coin. Derive imports them when a circuit takes a coin. Don't
  copy the local helpers in older examples' tests.
- A second contract (a test-only token the tests mint from) needs no script
  edits. Add `contract/<it>.compact`: `npm run compile` and `npm run compile:fast`
  compile every contract under `contract/` (skipping modules and imported
  files). Derive then adds its exports to `contract/index.ts`, plus a
  provider set and a deploy test before the main one in the devnet test. A
  second contract with witnesses of its own is wired by hand.
- The circuit-id union in `src/providers.ts` is derived from the compiled
  contract (`keyof ImpureCircuits`), so it never needs editing when circuits
  change.
- The example imports only published `@midnight-ntwrk/*` packages, so its code
  can be copied out of the repo and installed. Its wallet harness is
  `src/wallet.ts`, built on `@midnight-ntwrk/testkit-js`:
  `MidnightWalletProvider`, `syncWallet`, the funding gate
  (`waitForDust`, `waitForNightThenDust`) and `resolveWallet(network, role)`,
  which reads `MIDNIGHT_<NETWORK>_<ROLE>_SEED` (or `_MNEMONIC`) from the
  repo-root `.env.<network>`. Add a suite-specific role name to its
  `ROLE_ALIASES`. The in-memory harness is `src/test/sim.ts`. Don't depend on
  the repo's mnkit runtime packages here: CI rejects it. A remote wallet syncs
  from genesis, which takes over an hour on preprod.
