# SPEC — Voting

<!--
The design card for this example. The full design, threat model and the
decisions behind it are in the MIP Voting dApp design doc (rev 2).
-->

## Purpose

A fixed list of enrolled voters each cast one yes / no / abstain ballot on a
proposal, in one transaction. Nobody on chain learns who voted or how; the
admin can decrypt each ballot but not tell who cast it, and can't change or
silently drop one.

## Roles

| Role | Recognised by | Can |
|---|---|---|
| Admin | `adminKey(secretKey)` equals the `adminPk` field | enrol voters, publish admin encryption keys, open voting with a deadline, close early once every voter has cast, count ballots |
| Voter | a Merkle path from `voterKey(secretKey)` to the current `voters` root | cast one ballot per proposal; count their own ballot if the admin doesn't |
| Anyone | nobody; `count` has no caller check | submit a ballot opening that matches its commitment |

## Public ledger fields

| Field | Type | Written by | Why public |
|---|---|---|---|
| `adminPk` | `Bytes<32>`, sealed | constructor | admin circuits check the caller against it; a domain-separated hash of the admin's secret |
| `proposalId` | `Bytes<32>`, sealed | constructor | names the proposal; nullifiers and salts are bound to it and to the contract address (`kernel.self()`), so a voter's ballots in different votes, or in two deployments with the same label, can't be linked |
| `phase` | `Phase` | constructor, `open` | enrolment and voting are separate phases; the voter list is frozen once voting opens |
| `voters` | `MerkleTree<10, Bytes<32>>` | `enrol` | casts prove membership against its root without naming the leaf |
| `voterKeys` | `Set<Bytes<32>>` | `enrol` | rejects enrolling the same key twice (the roster is published anyway) |
| `adminEncKeys` | `Set<Bytes<32>>` | `addAdminKey` | voters' clients encrypt each ballot to every key in it |
| `enrolled` | `Counter` | `enrol` | `closeEarly` checks every enrolled voter has cast |
| `castCount` | `Counter` | `cast` | turnout; `closeEarly` compares it to `enrolled` |
| `ballots` | `Map<Bytes<32>, Bytes<32>>` | `cast` | nullifier → hiding commitment to the vote; `count` checks openings against it |
| `encBallots` | `Map<Bytes<32>, Opaque<"Uint8Array">>` | `cast` | the ballot opening encrypted to the admin keys, so the admin can count |
| `counted` | `Set<Bytes<32>>` | `count` | stops a ballot being counted twice; ballots not in it stay visible as uncounted |
| `yes` | `Counter` | `count` | the result |
| `no` | `Counter` | `count` | the result |
| `abstain` | `Counter` | `count` | turnout of abstentions |
| `deadline` | `Uint<64>` | `open` | `cast` closes at this block time (Unix seconds) |
| `countingEnds` | `Uint<64>` | `open` | `count` is allowed until this block time, 48 hours after the deadline (an early close doesn't move it) |
| `closedEarly` | `Boolean` | `closeEarly` | voting closed before the deadline because everyone had cast, so counting can start |

## Private state

Each participant keeps one `secretKey: Bytes<32>` (`VotingPrivateState`,
made by `createVotingPrivateState`), and a voter also sets the `vote` they are
about to cast. The admin's secret is separate from any voter's. The admin also
keeps an X25519 key pair off chain (not in contract private state) to decrypt
`encBallots`.

## Circuits

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|
| constructor | deployer (becomes admin) | `pid: Bytes<32>` | sets `adminPk`, `proposalId`, `phase = ENROLMENT` | — |
| `enrol` | admin | `pk: Bytes<32>` | adds `pk` to `voters` and `voterKeys`, increments `enrolled` | `Only the admin can do this`; `Enrolment is closed`; `Voter already enrolled`; `Voter list is full` |
| `addAdminKey` | admin | `key: Bytes<32>` | adds an X25519 public key to `adminEncKeys` (at most 8) | `Only the admin can do this`; `Enrolment is closed`; `Not an admin key` (all zeros); `Admin key already added`; `Too many admin keys` |
| `open` | admin | `d: Uint<64>` | sets `deadline = d`, `countingEnds = d + 48h`, `phase = OPEN` | `Only the admin can do this`; `Voting already opened`; `No voters enrolled`; `No admin encryption key`; `Deadline out of range`; `Deadline is in the past` |
| `cast` | voter | `enc: Opaque<"Uint8Array">`, `recipients: Vector<8, Bytes<32>>` (the admin keys `enc` is sealed to, zero-padded, first slot set) | checks every non-zero recipient is in `adminEncKeys`; stores `ballots[n] = ballotCommit(vote, salt)` and `encBallots[n] = enc`, increments `castCount` | `Voting is not open`; `Voting is closed`; `Path is not for this voter`; `Not an enrolled voter`; `Already voted`; `No ballot recipient`; `Ballot recipient is not an admin key` |
| `closeEarly` | admin | — | sets `closedEarly`, which ends casting and starts counting; `countingEnds` is unchanged | `Only the admin can do this`; `Voting is not open`; `Voting is closed`; `Not every voter has cast`; `Deadline already passed` |
| `count` | anyone | `n0: Bytes<32>`, `v0: Vote`, `s: Bytes<32>` | adds `n0` to `counted`, increments the counter for `v0` | `Voting has not opened`; `Voting is still open`; `Counting window has ended`; `No such ballot`; `Ballot already counted`; `Opening does not match the ballot` |
| `adminKey` (pure) | off chain | `sk: Bytes<32>` | `persistentHash([pad(32, "mip-vote:admin"), sk])` | — |
| `voterKey` (pure) | off chain | `sk: Bytes<32>` | `persistentHash([pad(32, "mip-vote:pk"), sk])` | — |
| `ballotNullifier` (pure) | off chain | `sk`, `pid`, `instance: Bytes<32>` (the contract address) | `persistentHash([pad(32, "mip-vote:cast"), sk, pid, instance])` | — |
| `ballotSalt` (pure) | off chain | `sk`, `pid`, `instance: Bytes<32>` | `persistentHash([pad(32, "mip-vote:salt"), sk, pid, instance])` | — |
| `ballotCommit` (pure) | off chain | `v: Vote`, `salt: Bytes<32>` | `persistentCommit(v, salt)`; the admin checks each decrypted opening with it before `count` | — |

## Witnesses

| Witness | Returns | From private state |
|---|---|---|
| `secretKey` | `Bytes<32>` | `secretKey` |
| `voterPath` | `MerkleTreePath<10, Bytes<32>>` | none; looked up in the current `voters` ledger (`findPathForLeaf`) |
| `vote` | `Vote` | `vote` |

## Privacy invariants

Each line ends with the key (or key prefix) of its entry in the
`assertNotInPublicState` call in `src/test/voting.sim.test.ts`.

- Never on chain: a voter's secret key. → `voterSecretKey`
- Never on chain: the ballot salt (derived from the voter's secret key). → `ballotSalt`
- Never on chain: the admin's secret key (only its hash, `adminPk`). → `adminSecretKey`

## Accepted leaks

- The voter roster: `enrol` writes each voter key to `voterKeys` and the tree,
  and the admin publishes the name ↔ key roster anyway. The admin is trusted to
  enrol exactly the agreed list (it could add phantom keys or leave someone
  out); voters check `voterKeys` and the root against the published roster
  before voting opens, after which the list is frozen.
- Turnout and timing: `castCount`, and the block time of each cast.
- The admin learns every vote (not who cast it) by decrypting `encBallots`,
  including a live private tally while voting is open.
- After counting, every ballot's vote is public under its nullifier: each
  `count` discloses `(n, vote)`. Nothing on chain links a nullifier to a voter,
  but anyone who links a cast transaction to a person (fee payment, network
  metadata, timing) learns that person's vote. With a handful of voters a
  unanimous result exposes every vote anyway.
- The admin encryption keys a voter's client reads come from the indexer. Two
  checks stop a substituted or added key from reading a vote. `cast` requires
  every recipient it names to be in `adminEncKeys`, so the real ledger state
  rejects a made-up key. The CLI also refuses to seal unless the keys match the
  admin key set fingerprint the admin announced (`--admin-keys`), so the blob
  never leaves the machine. The contract check alone isn't enough: a rejected
  transaction still reaches the node, which may be run by the same party as the
  indexer. The proof can't see inside `enc`, so a client that seals to other
  keys than it names isn't stopped. That only hurts its own voter.
- The contract refuses the all-zero key but can't check that an admin key is a
  usable X25519 key, and keys can't be removed once added. The CLI refuses to publish a low-order key or to
  open with one published, and a voter's client leaves unusable keys out of
  the ballot, so one bad key can't block casting.
- The CLI keeps the circuit's private state (the voter or admin secret) in
  memory for one run. It never writes it to the private-state store, so two
  identities sharing a fee wallet can't read or overwrite each other's secret.
- The CLI keeps the vote this machine cast in `.voting/` (mode 0600) so
  `self-count` can default to it.
- A voter can prove how they voted by revealing their opening (vote-buying is
  accepted for v1).
- Fee payment and network metadata can link a cast to a wallet or an IP; the
  cast itself carries no unshielded inputs or outputs.

## Out of scope

- The off-chain "I voted" participation proof (design doc R4, option A).
- A minimum voting period: `open` accepts any future deadline; the CLI
  defaults to 7 days.
- Key-committing ballot encryption: a voter's client could craft a blob that
  decrypts differently for different admin keys. It can't change what `count`
  accepts, only the admins' private previews.
- Threshold decryption, quorum, re-voting, weighted votes.
- A browser UI (a later milestone); this example ships an admin/voter CLI.

## Test-only contracts

None.
