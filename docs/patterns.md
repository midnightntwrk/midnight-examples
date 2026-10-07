# Pattern index: where each technique is shown

Find what your contract needs here, then read only that example's files.
Every example compiles and passes its tests against a local network in CI.
Entries name a symbol rather than a line number, so search the file for it.

## What to read in an example (and what to skip)

**Read:**
- `SPEC.md` (if there is one): the design in a page
- `contract/<name>.compact`
- `contract/witnesses.ts` (if there is one)
- the test bodies in `src/test/*.test.ts`: start reading after the
  `Your tests begin here` marker; everything above it is harness setup.

**Skip** (identical in every example, or generated):
- `src/wallet.ts`, `src/providers.ts`, `src/config.ts`
- `scripts/wait-for-dust.ts`, `compose.yml`
- `contract/managed/`, `ui/`, and anything under `node_modules/`

## Contract patterns

| You need | Example | File → symbol |
|---|---|---|
| Smallest contract: one public ledger write | hello-world | `hello-world.compact` → `storeMessage` |
| Arithmetic on a public `Uint` ledger value | calculator | `calculator.compact` → `add`, `square` |
| Witness does work off chain, circuit checks it | calculator | `calculator.compact` → `witness divMod`, `divide`; `witnesses.ts` → `divMod` |
| Hash commitment of a witness secret | secret-message | `secret-message.compact` → `publishMessageHash`, `hashMessageWithSeparator` |
| Domain-separated hashing, binding to `kernel.self()` | secret-message | `secret-message.compact` → `hashMessageWithAddress` |
| First caller becomes the owner; owner-only removal | secret-message | `secret-message.compact` → `publishMessageHashWithOwner`, `removeMessageHash` |
| Identity key derived from a witness secret | election, battleship | `getDappPubKey(localSk())` |
| Per-deployment identity (`kernel.self()` in the key) | private-bid | `private-bid.compact` → `derive` |
| Salted `persistentCommit`, then reveal | private-bid | `private-bid.compact` → `placeBid`, `revealBid` |
| Value stays private while a public bound is proven | private-bid | `placeBid` (`amount >= minimumBid`) |
| Commit-reveal with `persistentHash(value, sk)` | election | `election.compact` → `commitVote`, `revealVote`, `commitWithSk` |
| Commitment made in the constructor, revealed later | silent-auction | `silent-auction.compact` → `constructor`, `commitPrice`, `revealWin` |
| `sealed` (set-once) ledger fields | silent-auction, election, private-party | `export sealed ledger …` |
| State machine on an `enum` ledger field | battleship, silent-auction, election | `TurnState`, `AuctionState`, `VotingState` |
| Two roles and turn-taking | battleship | `battleship.compact` → `acceptGame`, `player1Shoot`, `checkBoard1` |
| Off-chain data checked against a commitment | battleship | `commitBoardSpace`, `checkBoard1` |
| `Set` guard against double actions | election | `registeredVoters`, `hashedVoteMap`, `revealedVoters` |
| `Counter` tallies | election, battleship | `candidate0VoteCounter`, `board1HitCount` |
| `Map` of bids (raise-only, highest bid) | silent-auction | `silent-auction.compact` → `bid` |
| Nested `Map`s; batched migration | zk-loan | `zk-loan.compact` → `loans`, `changePin` |
| Admin key, blacklist, admin rotation | zk-loan | `blacklistUser`, `rotateAdmin` |
| In-circuit Schnorr signature check (Jubjub) | zk-loan | `schnorr.compact` → `schnorrVerify`, `schnorrChallenge` |
| `pure circuit` reused off chain | zk-loan | `deriveUserPublicKey`, `schnorrChallenge` |

## Tokens

| You need | Example | File → symbol |
|---|---|---|
| Mint an unshielded token, then send or receive it | token-transfers | `mintAndReceive`, `sendToUser`, `receiveTokens` |
| Receive and send NIGHT | token-transfers, private-party | `receiveNightTokens`, `sendNightTokensToUser`; `checkIn`, `claimFees` |
| Check the contract's own balance | private-party | `claimFees` (`unshieldedBalanceGte`) |
| An unshielded NFT plus a NIGHT deposit and settlement | silent-auction | `receiveTokens`, `claimWin` |
| Shielded mint, send and receive | token-transfers | `mintShieldedToSelf`, `mintAndSendShielded`, `sendShieldedToUser` |
| A full shielded token (MIP-0011: mint, both burn paths, treasury) | shielded-chips | `chips.compact` → `mint`, `burn`, `mintToTreasury`, `burnFromTreasury` |
| Contract custody of coins, commitment escrow, `mergeCoin` order | shielded-chips | `roulette.compact` → `betColor`, `claimWinnings`, `escrowCommit` |
| Anonymous deposits into a contract-held pot; owner-only withdrawal | private-tip-jar | `private-tip-jar.compact` → `tip`, `reNonceToSelf`, `withdraw` |
| Shielded self-transfer to re-nonce a coin before using it | every example (from the template) | `src/wallet.ts` → `splitShieldedCoin` |
| DUST fee sponsorship (one wallet pays another's fees) | private-party | `src/sponsor.ts`, `src/test/sponsorship.test.ts` |

## Test patterns

| You need | Example | Where |
|---|---|---|
| Deploy, call, read the ledger back | hello-world, calculator | `src/test/*.test.ts` |
| Negative tests for every guard (rejected locally, so fast) | private-bid | `private-bid.test.ts` → the `rejects …` tests |
| Two identities from one fee-paying wallet | zk-loan | `zk-loan.test.ts` (two private-state ids) |
| Several contracts deployed from one harness | shielded-chips | `src/test/roulette.test.ts` |
| In-memory contract tests (no network, no proofs): `Sim.deploy`, `call`, `expectRejects` | calculator, private-tip-jar | `src/test/*.sim.test.ts`; API in [`packages/sim/src/index.ts`](../packages/sim/src/index.ts) |
| Asserting a secret never reaches public state | private-tip-jar (in memory), shielded-chips (devnet) | `private-tip-jar.sim.test.ts` → `assertNotInPublicState`; `src/test/privacy.test.ts` |
| Swapping caller or private state between calls | private-tip-jar | `private-tip-jar.sim.test.ts` → `sim.as(...)`, `sim.privateState = ...` |
| A lying witness is rejected by the circuit | calculator | `calculator.sim.test.ts` → `rejects a witness that lies` |
| A hand-written simulator class (many tests, custom fixtures) | zk-loan | `zk-loan.simulator.ts`, `zk-loan.sim.test.ts` |

Read [`compact-gotchas.md`](compact-gotchas.md) before you write the
contract.
