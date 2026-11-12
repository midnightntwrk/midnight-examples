# Voting Example

Anonymous, allow-listed voting on one proposal, with one transaction per voter.
It is built for MIP and MPS votes. The admin enrols a fixed list of voter keys and
opens voting with a deadline. Each voter then casts one yes / no / abstain ballot.

- The cast proves in zero knowledge that the voter is on the list, so it never
  names them. It publishes a per-proposal nullifier, so the voter can't vote twice.
- On chain the ballot is only a hiding commitment, plus a copy encrypted to the
  admin's keys.
- After voting closes, the admin decrypts the copies and submits each opening to
  `count`. `count` checks the opening against the stored commitment, so the admin
  can't change a vote.
- Anyone can submit an opening, so a voter can count their own ballot if the admin
  skips it.

The design, threat model and decisions are in `SPEC.md`, and in the MIP Voting
dApp design doc it summarises.

## Set up

Install dependencies from the repo root. The whole workspace shares one lockfile.

```bash
npm install
```

## Compile the contract

```bash
npm run compile         # or compile:fast (no proving keys) for the in-memory tests
```

## Run the test suite

The in-memory tests need no Docker. They cover every guard, the deadlines (with
a simulated block time), the bad-ballot fallback and the privacy invariants.

```bash
npm run compile:fast && npm run test:sim
```

The devnet suite runs the whole flow on a local network: deploy, enrol, open, two
casts at the same time from different wallets, close early, decrypt and count.

```bash
npm run env:up && npm run wait:dust
npm run test:local
npm run env:down
```

## Run a vote with the CLI

`npm run vote -- <command>` runs a vote on `MIDNIGHT_NETWORK` (local by default).
The header of `scripts/cli.ts` lists every command.

- **Keys.** These are secrets. The CLI keeps them in `examples/voting/.voting/`
  (gitignored), or in `VOTING_KEYS_DIR`.
- **Wallets.** Fees are paid by the wallet named with `--wallet` (default ALICE),
  from the repo-root `.env.<network>`. Voters who cast at the same time on one
  machine should each use their own `--wallet`: two runs on one fee wallet can
  clash over its DUST.
- **Private state.** The CLI keeps your secret in memory for one run only and
  never writes it to the private-state store, so identities sharing a fee
  wallet stay separate.
- **Password.** Off local, `MIDNIGHT_PRIVATE_STATE_PASSWORD` encrypts the
  private-state store `npm run deploy` uses. The other commands don't need it.
- **Proof server.** Start a proof server first (`npm run proof:up`).

```bash
# Admin, once:
npm run vote -- admin keygen

# Each voter, once: send the printed voter key to the admin
npm run vote -- voter keygen

# Admin, per vote:
npm run vote -- deploy --proposal MIP-0018
npm run vote -- add-admin-key              # publish your ballot-encryption key (up to 8 admin keys)
npm run vote -- enrol --roster roster.json # [{ "name": "...", "key": "<voter key>" }]
npm run vote -- open --days 7              # freezes the list; prints the deadline and the admin key set fingerprint

# Voters:
npm run vote -- cast yes --admin-keys <fp> # or no / abstain; one ballot, final

# Anyone:
npm run vote -- status                     # turnout, deadline, uncounted ballots

# Admin, after the deadline (or close-early once everyone has cast):
npm run vote -- count                      # decrypts and counts every ballot
npm run vote -- result                     # passes iff yes > no; a tie fails

# A voter whose ballot is still uncounted near the end of the 48-hour window:
npm run vote -- self-count
```

Publish the roster and the voter-tree root printed by `enrol` before you open
voting. Anyone can then check that the list wasn't changed. Once voting is open,
the contract rejects further enrolment.

When you open voting, announce the admin key set fingerprint that `open` prints
(`status` prints it too) on the same channel as the roster. `cast` reads the
admin keys from the indexer and refuses to seal a ballot unless they match the
fingerprint passed in `--admin-keys` (or `VOTING_ADMIN_KEYS`). Without that
check, an indexer that swapped in or added a key could read the vote.

## Rules the contract enforces

- `cast` is accepted only while the block time is before `deadline`, and only
  until an early close.
- `cast` names the admin keys its ballot is sealed to (up to 8, zero-padded),
  and each must be a published admin key. A ballot sealed to a key the indexer
  made up is rejected on chain.
- `closeEarly` is admin-only, and only once every enrolled voter has cast. It ends
  casting and starts counting early.
- `count` is accepted from the close until 48 hours after the deadline. An early
  close doesn't move that end, so voters always keep the announced time to count
  their own ballot. When the window ends, the counters are the result. Any ballot
  not in `counted` stays visible on chain as uncounted and is left out.
- Nullifiers, salts and the encrypted ballots are bound to the proposal *and* the
  contract address. A rehearsal and the real vote, or a clone that reuses the
  label, can't link a voter's ballots.
- After counting, each ballot's vote is public under its nullifier. Anyone who can
  link a cast transaction to a person (fees, network metadata) learns their vote.
  See `SPEC.md` → Accepted leaks.
- The deadline check uses the landing block's time with no tolerance. A cast
  built just before the deadline that lands after it is rejected, so announce
  deadlines with a margin. The CLI compares deadlines with the latest block's
  time from the indexer, not your machine's clock.
- `addAdminKey` refuses low-order X25519 keys, which nobody could encrypt a
  ballot to.

## What this example doesn't do

- **"I voted" proofs.** The off-chain participation proof (design doc R4) is a
  follow-up.
- **Threshold decryption.** Every admin key can decrypt every ballot.
- **Quorum, re-voting and weighted votes.** None of these are supported.
- **Browser UI.** A browser UI is the next milestone.
