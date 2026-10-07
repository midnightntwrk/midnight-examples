# AGENTS.md — private-tip-jar

**Verified against:** Compact language `0.23`, compiler `0.31.1`,
`@midnight-ntwrk/midnight-js-*` `4.1.1`, wallet SDK `1.2.0`, Node 22.

## What it teaches

- **Anonymous deposits into a contract.** `tip(coin)` has no caller check and
  calls no witness, so the contract never learns who tipped. It runs
  `receiveShielded`, then re-sends the coin to `kernel.self()` (`reNonceToSelf`,
  the technique from `shielded-chips` roulette `houseDeposit`) and stores only
  that contract-owned coin in `pot` with `insertCoin`. The tipper's own coin
  nonce never reaches the ledger.
- **Owner-only withdrawal from a hashed witness key.** The constructor stores
  `ownerKey(sk) = persistentHash([pad(32, "private-tip-jar:owner:"), sk])` in a
  `sealed` field. `withdraw(tipKey)` recomputes it from the `ownerSecretKey`
  witness and pays the pot coin to `ownPublicKey()` with `sendShielded`.
  `ownerKey` is an exported `pure circuit`, so tests and a UI can compute the
  expected owner value off chain.
- **One accepted color, fixed at deploy.** `tipColor` is `sealed`; tips of any
  other color, and zero-value tips, are rejected by `assert`s before any coin
  moves.
- **Getting shielded test coins.** `contract/tip-token.compact` is a demo
  faucet (anyone can mint) that exists only so the tests have shielded coins.
  Its color is derived off chain with `rawTokenType(domain, address)`.
- **Tipper-side re-nonce.** `splitShieldedCoin` in `src/wallet.ts` (ported
  from `shielded-chips`) does a shielded self-transfer so the coin a tipper
  tips has a nonce the token's issuer has never seen.
- **A privacy test over public state.** The test collects every byte string in
  the jar's ledger and asserts that no tipper key, tipper secret, tipped coin
  nonce, issuer-known coin nonce, or owner secret appears in it.

## Privacy: what is public and what isn't

Read the ledger, not the `disclose()` calls, to see what is public. The ledger
is exactly `owner`, `tipColor` and `pot`.

**Hidden (and checked by the privacy test):**

- Who tipped. No field is derived from a tipper's wallet key, a tipper secret
  or the tipper's coin nonce. The tipper's coin is spent through Zswap, which
  publishes a nullifier and commitments, not the coin or its owner.
- The coins tippers spent. `pot` holds re-nonced, contract-owned coins only.
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
- **Issuer linkage if you skip the self-transfer.** `sendShielded` derives the
  re-nonced coin's nonce from the tipped coin's nonce alone. Anyone who knows
  the nonce of the coin you tip (whoever minted or sent it to you) can
  recompute the pot entry and recognise your tip. A shielded self-transfer
  first (`splitShieldedCoin`) closes this; the test does it. In the test the
  issuer is also the jar owner, which is exactly the case that matters.
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
- `src/` harness. It differs from the template in two places: `src/wallet.ts`
  adds `splitShieldedCoin` (shielded self-transfer), and `src/providers.ts`
  adds a random suffix to the private-state store name so several provider
  sets can be built in the same millisecond.
- `src/test/private-tip-jar.test.ts`: Alice (owner, token minter) and Bob
  (tipper). Covers mint, deploy, re-nonce, two tips, the privacy test, a
  negative test for every guard (wrong color, zero value, non-owner withdraw,
  unknown or already-withdrawn tip) and the owner's withdrawal.

## Run

```bash
yarn compile && yarn typecheck   # cheap checks first
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

- A tip is the whole coin passed to `tip`. To tip an exact amount, make a coin
  of that value first; `splitShieldedCoin(color, amount)` does that and
  re-nonces it at the same time.
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
