# Lottery UI

Browser frontend for `examples/lottery`: connect a Midnight wallet,
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `npm run new:ui lottery` from `packages/mnkit/templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

What it adds on top of the scaffold:

- **Deploy as organizer:** a ticket-price, ticket-cap and end-of-sales form,
  pre-checked the way the constructor checks them (plus a check the contract
  leaves to the UI: the end of sales must be in the future). Deploying makes a fresh secret key and
  draw seed, kept encrypted in this browser.
- **Join as a player:** a browser that joins gets its own fresh secret.
- **Role-aware actions:** the organizer sees *Close sales* and *Draw the
  winner*. A player sees *Buy a ticket*, *Close sales* and *Claim the prize*.
  *Close sales* unlocks for everyone once sales end or every ticket is sold.
  Each button is disabled with the reason when the contract would reject the
  call (`actionError`, tested against the real circuits at block times either
  side of the end of sales). The panel re-reads the clock every few seconds,
  so buttons change when sales end even if the ledger doesn't.
- **Your tickets and the result:** the panel finds this browser's tickets and
  whether it won by recomputing its player key with the contract's
  `pureCircuits.playerKey`.
- **Nothing pasted:** buyTicket gets a fresh random nonce per ticket, and
  claimPrize pays to the wallet's own unshielded address.

Private state is `persistent`. For the organizer it holds the draw seed, and
the seed exists nowhere else: losing it (clearing site data, forgetting the
passphrase, deploying from one browser profile and trying to draw from
another) means the lottery can never be drawn and the pot is stuck. For a
player it holds the secret behind their tickets.

Tickets are paid in unshielded NIGHT (`ticketPrice` in STAR: 1 NIGHT =
1,000,000 STAR), so a player's wallet needs NIGHT as well as DUST.

## TODO: end-to-end verification with a wallet

Not yet run. Everything below needs a human to approve wallet prompts. What *has* been
verified is in `packages/mnkit/templates/ui/VERIFIED.md`, generated from this UI's
`verification.json`. When you run these, tick them off. Once all pass, set
`walletDeploy` and `walletCalls` to `verified` in `verification.json` (with the
date and what ran), run `npm run new:ui -- lottery --sync`, and delete this section.

Setup: `npm run env:up && npm run wait:dust` in `examples/lottery`, `npm run dev -w
@midnight-ntwrk/example-lottery-ui`, and three Chrome profiles:
O (organizer), A and B (players), each with its own browser wallet on
`undeployed`. Fund all three, NIGHT included, with `npm run fund:wallet
<mn_dust_…> <mn_addr_…>` from the repo root; the page's "no DUST" hint prints the command.

- [ ] **Unlock:** O connects and sets a passphrase; the panel appears.
- [ ] **Deploy (wallet proving):** O deploys with price 1000, max 3 and sales
      ending in about 15 minutes; the card says "You are the organizer",
      "Tickets on sale" and shows the end of sales. A past end time is
      refused before deploying.
- [ ] **Organizer can't buy:** O sees no Buy button (organizer actions only).
- [ ] **Join + buy (unshielded NIGHT in):** A and B join by address, set
      their own passphrases and buy one ticket each. The wallet adds the
      1000 STAR input while balancing; each sees "Your tickets: #n" and the
      pot shows 2000.
- [ ] **Too early to close:** with one ticket left and time remaining, *Close
      sales* is disabled for O, A and B with "Sales are still open".
- [ ] **Close + draw:** A buys the last ticket (pot 3000); B closes sales, then
      O draws. Everyone sees the winning ticket, and the winner sees "Your
      ticket won!".
- [ ] **Deadline:** on a second lottery, let the end of sales pass with one
      ticket sold. *Buy a ticket* disables and *Close sales* unlocks for a
      player, whose close succeeds.
- [ ] **Claim (unshielded NIGHT out):** the loser's Claim stays disabled. The
      winner claims; state shows "Prize paid" and their NIGHT balance rises
      by 3000 STAR.
- [ ] **Reload before the draw:** reload O after closing sales. After the
      same passphrase it re-joins, still shows the organizer role, and the
      draw succeeds (the seed survived).
- [ ] **Wrong passphrase:** reload O with a different passphrase; it is
      refused.

## Run

```bash
npm run compile -w @midnight-ntwrk/example-lottery          # contract first
cd examples/lottery && npm run env:up && npm run wait:dust  # local devnet
npm run dev -w @midnight-ntwrk/example-lottery-ui           # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`npm run fund:wallet <mn_dust_…> [mn_addr_…]`, from the repo root. The
page prints the exact command when the connected wallet has no DUST.

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
