# SPEC — Lottery

## Purpose

Players buy tickets for a fixed NIGHT price until a deadline fixed at
deployment, and the organizer draws one winning ticket, whose holder claims the
whole pot. The draw is fair against everyone but the organizer. The organizer
commits to a secret seed before any ticket is sold, and every ticket mixes
fresh entropy into the draw, so no player can predict or steer the winner. The
circuit proves the draw was computed from the committed seed without the seed
ever being published. Sales end at the deadline or when every ticket is sold,
and then anyone can close them, so the organizer can't pick the moment sales
stop.

## Roles

| Role | Recognised by | Can |
|---|---|---|
| Organizer | `persistentHash([pad(32, "lottery:organizer:"), secretKey])` equals the `organizer` field | draw the winner |
| Player | `playerKey(kernel.self().bytes, secretKey)`, the key stored with each ticket | buy any number of tickets while sales are open; claim the pot if they hold the winning ticket |
| Anyone | — | close ticket sales once `salesEnd` has passed or every ticket is sold |

The player key hashes in the contract address (the private-bid pattern), so the
same secret gives an unlinkable player key in each deployment. The organizer key can't be bound the same way, because
`kernel.self()` returns a different value inside the constructor, which is
where that key is stored. A fresh organizer secret per lottery keeps
lotteries unlinked instead; reusing one publishes the same `organizer` value
in each.

## Public ledger fields

| Field | Type | Written by | Why public |
|---|---|---|---|
| `organizer` | `Bytes<32>`, sealed | constructor | `draw` checks the caller against it, and `buyTicket` refuses it; it is a hash of the organizer's secret |
| `seedCommitment` | `Bytes<32>`, sealed | constructor | binds the organizer to the seed before any ticket is sold; `draw` checks the revealed seed against it |
| `ticketPrice` | `Uint<64>`, sealed | constructor | players must know the price; `buyTicket` receives exactly this much NIGHT |
| `maxTickets` | `Uint<16>`, sealed | constructor | caps sales; `buyTicket` checks it, and a sell-out lets `closeSales` run early |
| `salesEnd` | `Uint<64>`, sealed, Unix seconds | constructor | when sales end; `buyTicket` requires `blockTimeLt(salesEnd)`, `closeSales` accepts `blockTimeGte(salesEnd)` |
| `state` | `LotteryState` (`OPEN`, `CLOSED`, `DRAWN`, `PAID`) | constructor, `closeSales`, `draw`, `claimPrize` | the state machine every circuit checks |
| `tickets` | `Map<Uint<16>, Bytes<32>>`, ticket number → player key | `buyTicket` | `draw` looks up the winning ticket's holder |
| `ticketCount` | `Counter` | `buyTicket` | the next ticket number, the cap check and the divisor of the draw |
| `pot` | `Uint<128>` | `buyTicket`, `claimPrize` | the NIGHT the winner receives; shown to players |
| `entropy` | `Bytes<32>` | constructor (a fixed tag), `buyTicket` | running hash of every ticket's nonce; `draw` mixes it with the seed |
| `winningTicket` | `Uint<16>` | `draw` | the outcome |
| `winner` | `Bytes<32>` | `draw` | `claimPrize` checks the caller against it |

## Private state

`secretKey: Bytes<32>` (identity) and `seed: Bytes<32>` (the draw seed), both
random, made by `createLotteryPrivateState`. They are separate secrets, so
revealing one never gives away the other. Only the organizer's `seed` is ever
used. One `secretKey` serves both roles under different hash purposes, so
`buyTicket` can tell when the organizer's own secret is buying.

## Circuits

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|
| constructor | deployer (becomes organizer) | `price: Uint<64>`, `max: Uint<16>`, `end: Uint<64>` (Unix seconds) | sets `organizer`, `seedCommitment = persistentHash([pad(32, "lottery:seed:"), seed])`, `ticketPrice`, `maxTickets`, `salesEnd = end`, `entropy`, `state = OPEN`. `end` isn't checked against the clock: a past deadline only makes a lottery nobody can buy into, and the UI refuses one | `Ticket price must be positive`; `A lottery needs at least two tickets` |
| `buyTicket` | player | `nonce: Bytes<32>`, random per ticket | receives `ticketPrice` NIGHT; `tickets[ticketCount] = playerKey`; `entropy = persistentHash([entropy, playerKey, nonce])`; increments `ticketCount`; adds the price to `pot` | `Ticket sales are closed`; `Ticket sales have ended`; `The organizer cannot buy tickets`; `All tickets are sold` |
| `closeSales` | anyone | — | `state = CLOSED` | `Ticket sales are closed`; `Sales are still open` (before `salesEnd` with tickets left); `No tickets were sold` |
| `draw` | organizer | — | checks the seed against `seedCommitment`. Then takes `h` = the first 8 bytes of `persistentHash([pad(32, "lottery:draw:"), seed, entropy])` as a `Uint<64>`, gets `[q, r]` from the `divMod` witness and checks `q * ticketCount + r == h` and `r < ticketCount`. Sets `winningTicket = r`, `winner = tickets[r]`, `state = DRAWN` | `Only the organizer can draw`; `Sales must be closed before the draw`; `Seed does not match the commitment`; `Incorrect division` |
| `claimPrize` | player holding the winning ticket | `to: UserAddress` | sends the whole `pot` in NIGHT to `to`; `pot = 0`; `state = PAID` | `The draw has not happened`; `Only the winner can claim` |
| `organizerKey` (pure) | off chain | `sk: Bytes<32>` | `persistentHash([pad(32, "lottery:organizer:"), sk])` | — |
| `playerKey` (pure) | off chain | `lottery: Bytes<32>`, `sk: Bytes<32>` | `persistentHash([pad(32, "lottery:player:"), lottery, sk])`; circuits pass `kernel.self().bytes` | — |

## Witnesses

| Witness | Returns | From private state |
|---|---|---|
| `secretKey` | `Bytes<32>` | `secretKey` |
| `seed` | `Bytes<32>` | `seed` |
| `divMod` | `[Uint<64>, Uint<64>]`, the quotient and remainder of `h / ticketCount` | none: computed from its arguments, then checked by `draw` |

## Privacy invariants

- Never on chain: the organizer's secret key (only its hash, `organizer`). → `organizerSecretKey`
- Never on chain: the draw seed, before or after the draw (only `seedCommitment` and the outcome). → `seed`
- Never on chain: a player's secret key (only its hash, in `tickets`). → `playerSecretKey`
- Never on chain: a ticket's nonce (only the running `entropy` hash). → `ticketNonce`

## Accepted leaks

- Which player key holds each ticket, how many tickets each key bought, and when.
- Ticket payments are unshielded NIGHT, so the paying wallet of each `buyTicket` is public, which links a player key to a wallet.
- The pot, and the address the winner chooses to be paid at.
- The draw is verifiable only through the proof. Without the seed nobody can recompute it off chain, which is the price of keeping the seed secret.
- Every `buyTicket` updates `ticketCount`, `entropy` and `pot`, so two purchases built against the same state conflict and one fails. It costs a retry, not fairness.

## Out of scope

- Trustless draws. The organizer knows the seed, so after every ticket they know who would win if sales closed then. `salesEnd` and closing by anyone take away their choice of when sales stop, but the organizer is still trusted not to:
  - play, or collude with a player. `buyTicket` refuses the organizer's own key, but under a second key, or through a friend, the organizer can grind the last ticket's nonce to pick the winner;
  - leak the seed, which gives whoever holds it the same power;
  - refuse to draw a result they dislike. The pot then stays in the contract for good.

  An all-player commit-reveal removes this trust at the cost of reveal deadlines and forfeits.
- A draw deadline and refunds, which would turn a refused draw into a refund instead of a stuck pot.
- Exact deadlines. `blockTimeLt` and `blockTimeGte` compare against the block's time when the transaction is applied, not when it was proved, so a purchase sent just before `salesEnd` can land after it and be rejected. Treat block time as accurate to seconds or minutes.
- An organizer fee, several winners or several rounds per deployment.
- Shielded tickets or anonymous winners: tickets are public on purpose.

## Test-only contracts

None.
