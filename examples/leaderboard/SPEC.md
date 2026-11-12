# SPEC — Leaderboard

<!--
The design card for this example (generation flow step 1, docs/generation-flow.md).
Written when the example was ported from midnightntwrk/midnight-leaderboard.
AGENTS.md → "Privacy" has the longer reasoning.
-->

## Purpose

An arcade-style leaderboard. Anyone can post a score, either under a name they
choose or anonymously, and later prove they posted a given entry without
revealing the key that links their entries.

## Roles

| Role | Recognised by | Can |
|---|---|---|
| Player | anyone; `submitScore` has no caller check | post any number of scores, each as a new entry |
| Entry owner | `ownerCommitment(localSecretKey)` equals the entry's `ownerHash` | prove ownership of that entry with `verifyOwnership` |

## Public ledger fields

| Field | Type | Written by | Why public |
|---|---|---|---|
| `scores` | `Map<Uint<64>, ScoreEntry>` (`score`, `displayName`, `ownerHash`) | `submitScore` (insert) | the leaderboard is public by design: anyone reads and ranks it |
| `nextId` | `Counter` | `submitScore` (increment) | gives every entry its own key |

## Private state

Each player's `secretKey: Bytes<32>`, made once per browser (the UI keeps it in
`localStorage`) and passed to `createLeaderboardPrivateState`. The custom name
for the next submission is set off chain with `setCustomName` and is not part
of the stored private state.

## Circuits

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|
| `submitScore` | anyone | `score: Uint<64>`, `useCustomName: Boolean` | increments `nextId` and inserts a `ScoreEntry` at the new id: the score, the custom name or `persistentHash(secretKey)`, and `ownerCommitment(secretKey)` | — |
| `verifyOwnership` | entry owner | `targetEntryId: Uint<64>` | none; the proof is the result | `entry not found`; `not the owner` |
| `ownerCommitment` (pure) | off chain | `sk: Bytes<32>` | `persistentHash([pad(32, "leaderboard:owner:"), sk])` | — |

## Witnesses

| Witness | Returns | From private state |
|---|---|---|
| `localSecretKey` | `Bytes<32>` | `secretKey` |
| `getCustomName` | `Bytes<32>` | none; the name passed to `setCustomName`, UTF-8, truncated and zero-padded to 32 bytes |

## Privacy invariants

Each line ends with the key of its entry in the `assertNotInPublicState` call
in `src/test/leaderboard.sim.test.ts` (and, on the network, in
`src/test/leaderboard.test.ts`).

- Never on chain: any player's secret key (only hashes of it). → `aliceSecretKey`, `bobSecretKey`

## Accepted leaks

- Every score, and every custom display name, in the clear.
- Entries by the same key are linkable: they share `ownerHash`, and anonymous
  entries also share `displayName` (`persistentHash(secretKey)`). Use a fresh
  key for entries that must not be linked.
- `ownerCommitment` does not include `kernel.self()`, so the same key gives
  the same `ownerHash` on every leaderboard deployment.
- A successful `verifyOwnership` transaction shows that someone proved
  ownership of that entry id, and when.
- Count and timing of submissions (circuit names and block times are public
  through the indexer).
- Whether DUST fee payment links an entry to the player's wallet is not
  analysed.

## Out of scope

- Score validation: the contract accepts any score. A real game would have the
  score attested or computed in the circuit.
- Removing or editing entries.
- Unlinkable entries for one player (would need a per-entry key or nonce).
