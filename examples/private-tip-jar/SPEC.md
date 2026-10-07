# SPEC — Private Tip Jar

<!--
The design card for this example (generation flow step 1, docs/generation-flow.md).
Written after the fact for the Phase 1 baseline run, as the worked example of
templates/example/SPEC.md. AGENTS.md → "Privacy" has the longer reasoning.
-->

## Purpose

Anyone can leave a shielded tip in a jar without the contract recording who
tipped. Only the jar's owner can withdraw.

## Roles

| Role | Recognised by | Can |
|---|---|---|
| Owner | `ownerKey(ownerSecretKey)` equals the `owner` field | withdraw any tip |
| Tipper | nobody; `tip` has no caller check and calls no witness | tip a coin of the accepted color |

## Public ledger fields

| Field | Type | Written by | Why public |
|---|---|---|---|
| `owner` | `Bytes<32>`, sealed | constructor | `withdraw` checks the caller against it; it's a domain-separated hash of the owner's secret |
| `tipColor` | `Bytes<32>`, sealed | constructor | `tip` checks the coin's color against it |
| `pot` | `Map<Bytes<32>, QualifiedShieldedCoinInfo>`, keyed by nonce | `tip` (insert), `withdraw` (remove) | the contract needs each whole coin to spend it later without anyone handing it a secret |

## Private state

The owner's `ownerSecretKey: Bytes<32>`, made fresh per jar by the deployer
(`createPrivateTipJarPrivateState`). Tippers keep nothing.

## Circuits

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|
| constructor | deployer (becomes owner) | `acceptedColor: Bytes<32>` | sets `owner` and `tipColor` | — |
| `tip` | anyone | `coin: ShieldedCoinInfo` | receives the coin, re-sends it to the contract with a new nonce, stores that coin in `pot` | `Tips must be paid in the jar's token`; `A tip must be worth something` |
| `withdraw` | owner | `tipKey: Bytes<32>` | pays the `pot` coin at `tipKey` to the caller's coin key and removes it | `Only the owner can withdraw`; `No such tip in the jar` |
| `ownerKey` (pure) | off chain | `sk: Bytes<32>` | `persistentHash([pad(32, "private-tip-jar:owner:"), sk])` | — |

## Witnesses

| Witness | Returns | From private state |
|---|---|---|
| `ownerSecretKey` | `Bytes<32>` | `ownerSecretKey` |

## Privacy invariants

Each line is an entry in the `assertNotInPublicState` call in
`src/test/private-tip-jar.sim.test.ts` (and, on the devnet, in
`src/test/private-tip-jar.test.ts`).

- Never on chain: a tipper's coin public key.
- Never on chain: the nonce of the coin a tipper spent.
- Never on chain: the owner's secret key (only its hash, `owner`).
- Never on chain: the owner's coin public key.

## Accepted leaks

- Every tip amount: each `pot` entry is a whole coin, value included.
- Count and timing of tips and withdrawals (circuit names and block times are
  public through the indexer).
- The accepted color, and the owner hash. The same owner secret in two jars
  gives the same `owner`, so use a fresh secret per jar.
- Issuer linkage if the tipper skips the shielded self-transfer: the pot
  nonce is derived from the tipped coin's nonce, which its issuer knows.
- Where the owner's payout goes, to anyone who guesses the owner's wallet.
- Whether DUST fee payment links a tip to the tipper's wallet is not analysed.

## Out of scope

- Hiding tip amounts (needs an off-chain opening from tipper to owner).
- Several owners, or changing the owner.
- A tip token: `contract/tip-token.compact` is a demo faucet for the tests.
