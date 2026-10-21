# AGENTS.md — private-tip-jar

**Verified against:** Compact language `0.23`, compiler `0.31.1`,
`@midnight-ntwrk/midnight-js-*` `4.1.1`, wallet SDK `1.2.0`, Node 22.

## What it teaches

- **Anonymous deposits into a contract.** `tip(coin)` has no caller check and
  calls no witness, so the contract never learns who tipped. It runs
  `receiveShielded` and stores the coin in `pot` with `insertCoin`.
- **The coin argument is a new coin, not a wallet coin.** `receiveShielded`
  creates a Zswap output to the contract. The tipper's wallet balances the
  transaction from whichever of its coins it selects and makes change. So the
  client passes `freshCoin(color, amount)` from `@midnight-ntwrk/example-coins`,
  a coin with a fresh random nonce. That nonce is in no commitment but the contract's own, so
  publishing it links to nobody, and any amount works without a split first.
  There is no re-nonce to `kernel.self()`: that only repairs a client that
  passed a wallet coin's nonce, and it doesn't hide it from whoever knows
  that nonce.
- **Owner-only withdrawal from a hashed witness key.** The constructor stores
  `ownerKey(sk) = persistentHash([pad(32, "private-tip-jar:owner:"), sk])` in a
  `sealed` field. `withdraw(tipKey)` recomputes it from the `ownerSecretKey`
  witness and pays the pot coin to `ownPublicKey()` with `sendShielded`.
  `ownerKey` is an exported `pure circuit`, so tests and a UI can compute the
  expected owner value off chain.
- **One accepted color, fixed at deploy.** `tipColor` is `sealed`; tips of any
  other color, zero-value tips, and tips whose nonce is already a pot key (they
  would overwrite that entry and strand its coin) are rejected by `assert`s
  before any coin moves.
- **Getting shielded test coins.** `contract/tip-token.compact` is a demo
  faucet (anyone can mint) that exists only so the tests have shielded coins.
  Its color is derived off chain with `rawTokenType(domain, address)`.
- **A privacy test over public state.** The test collects every byte string in
  the jar's ledger and asserts that no tipper key, tipper secret, nonce of a
  coin in the tipper's wallet (including the one the issuer minted), or owner
  secret appears in it.

## Privacy: what is public and what isn't

Read the ledger, not the `disclose()` calls, to see what is public. The ledger
is exactly `owner`, `tipColor` and `pot`.

**Hidden (and checked by the privacy test):**

- Who tipped. No field is derived from a tipper's wallet key, a tipper secret
  or any of the tipper's wallet coins. The wallet coins that pay for a tip are
  spent through Zswap, which publishes nullifiers and commitments, not the
  coins or their owner.
- The coins tippers spent. `pot` holds only the coins each tip created for the
  contract, under nonces no wallet coin shares.
- The owner's secret key. Only its domain-separated hash (`owner`) is stored.

**Public by design (accepted leaks):**

- **Every tip amount.** Each `pot` entry is a full `QualifiedShieldedCoinInfo`,
  value included, because the contract needs the whole coin to spend it later
  without anyone handing it a secret. An observer sees "someone tipped 40".
  Hiding amounts would need a commitment the owner can open, which needs the
  tipper to pass the opening to the owner off chain; this example doesn't.
- **Count and timing of tips and withdrawals.** Circuit names (`tip`,
  `withdraw`) are public through the indexer's `entryPoint`, with their block
  times, and each withdrawal removes a visible pot entry. Tip timing can be
  correlated with other activity (for example a tipper's wallet going online).
- **The accepted token color**, and that the jar has an owner (`owner`, a
  hash). The same owner secret in two jars gives the same `owner` value, so use
  a fresh secret per jar. `ownerKey` does not include `kernel.self()`.
- **The tipped coin, nonce included** (each `pot` entry). That is safe only
  because the nonce is fresh. A client that passes the nonce of a coin it holds
  puts the same nonce in its wallet coin's commitment too, and anyone who can
  guess the wallet's key (the coin's issuer, for one) can then confirm the tip
  was theirs. The contract cannot tell a fresh nonce from a reused one, so it
  is the client's job: use `freshCoin`, as the tests do.
- **Where the owner's money goes.** A withdrawal's payout nonce is derived from
  a pot nonce that is public, so anyone who guesses the owner's wallet key can
  confirm it received the payout. The owner is a public role here; this design
  doesn't try to hide the owner's wallet.
- **Fee payment.** Every `tip` transaction is balanced and fee-paid in DUST by
  the tipper's own wallet. This example does not analyse whether fee payment
  links a tip to the tipper's wallet, and makes no claim that it doesn't.
- **Demo token mints.** `tip-token.compact` mint amounts and recipients'
  outputs are created by the minter, who knows the minted coin. It is test
  scaffolding, not part of the tip jar's privacy story.

## Layout

- `contract/private-tip-jar.compact`: the tip jar. `contract/tip-token.compact`:
  the demo faucet token used by the tests. Both are committed, and `yarn compile`
  builds each into its own `contract/managed/<name>/`.
- `contract/index.ts` exports both (`CompiledPrivateTipJarContract`,
  `CompiledTipTokenContract`, `zkConfigPath`, `tipTokenZkConfigPath`).
- `contract/witnesses.ts`: `ownerSecretKey` and
  `createPrivateTipJarPrivateState(ownerSecretKey)`. No `node:*` imports.
- `src/` harness. It differs from the template in one place: `src/providers.ts`
  adds a random suffix to the private-state store name so several provider
  sets can be built in the same millisecond.
- `SPEC.md`: the design card (the worked example for `templates/example/SPEC.md`).
- `src/test/private-tip-jar.sim.test.ts`: the same guards, flow and privacy
  invariants in memory (`yarn compile:fast && yarn test:sim`, under a second),
  using `@midnight-ntwrk/example-sim`'s `assertNotInPublicState`.
- `src/test/private-tip-jar.test.ts`: Alice (owner, token minter) and Bob
  (tipper). Covers mint, deploy, two fresh-nonce tips paid from one minted
  coin, the privacy test, a negative test for every guard (wrong color, zero
  value, reused pot key, non-owner withdraw, unknown or already-withdrawn tip)
  and the owner's withdrawal.

## Run

```bash
yarn compile:fast && yarn typecheck && yarn test:sim   # seconds, no Docker
yarn validate                    # compile, env:up, wait:dust, test:local, env:down
```

`yarn validate` exits non-zero if any step fails, and always takes the network
down. While fixing tests, `yarn validate --keep-net` leaves the network up so
the next run skips the restart. Step by step:

```bash
yarn env:up && yarn wait:dust
yarn test:local
yarn env:down
```

## Notes for agents

- A browser UI is phase 2. Once `yarn validate` passes, run
  `yarn new:ui private-tip-jar` from the repo root, then build the use case into its
  seed files. See `templates/ui/AGENTS.md`.

- A tip is the coin passed to `tip`, built fresh with `freshCoin(color, amount)`
  (`@midnight-ntwrk/example-coins`; the sim tests use its `simCoin`).
  Never pass a coin from `availableCoins`: its nonce is shared with your
  wallet coin. The wallet pays for the tip and makes change, so no split or
  exact-value coin is needed. `splitShieldedCoin` in `src/wallet.ts` is
  template code this example doesn't use.
- `withdraw` moves one pot coin per call. Iterate over `ledger(...).pot` to
  empty the jar.
- The guards in `tip` run before `receiveShielded`, so the negative tests pass
  made-up coins; they are rejected locally before anything is proven or spent.
- `contract/managed/` is generated by `yarn compile` and gitignored. The TS
  harness imports from it, so nothing type-checks until you have compiled at
  least once.
- The circuit-id union in `src/providers.ts` is derived from the compiled
  contract (`keyof ImpureCircuits`), so it never needs editing when circuits
  change.
- Remote-network wiring is shared, not copied. `src/wallet.ts` takes an optional
  `{ fastSync }` and the test resolves its wallet with
  `resolveWallet(network, role)` from `@midnight-ntwrk/example-fast-sync`. Do not
  write a per-example seed resolver; the shared one knows every suite's role
  names and reads the repo-root `.env.<network>`. See `FAST-SYNC.md`.
