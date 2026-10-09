# Shielded Chips UI

Browser frontend for `examples/shielded-chips`: a roulette table that plays
the Node test's round (`src/test/roulette.test.ts`) behind a Midnight wallet,
with the house in one browser profile and each player in their own.

| Who | Steps |
|---|---|
| House | deploy the chips token → deploy a table (winning number committed) → mint chips to players → deposit match coins → reveal → sweep the pool. Also burn chips and mint/burn the token's treasury. |
| Player | share your shielded address → bet RED or BLACK → claim 2x, or forfeit a losing bet |

Scaffolded by `yarn new:ui shielded-chips --contract roulette` from
`templates/ui/`. See `AGENTS.md` next to this file for which files are
template-owned and which are yours, and for the verification checklist.

## What this UI adds on top of the scaffold

- **Two contracts.** The UI was generated for `roulette`. The chips token is
  wired in `src/midnight/shielded-chips-api.ts` with its own
  `CompiledContract` and its own providers bundle
  (`useMidnightProviders().providersFor("managed/chips")`). `copy:zk` serves
  both contracts' keys. The house's chips address is kept in `localStorage`
  per network, next to the table address the template remembers.
- **One house key for both contracts.** Deploying the chips token stores a
  fresh secret key in its private state. The table is deployed with that
  same key, so both contracts know the same house. The winning number isn't
  stored: only `H(number, key)` is on chain, and the house recovers the number
  from its key at reveal time (`recoverWinningNumber`, 37 candidates).
- **Fresh coins as circuit arguments.** The Node test passes a coin it finds
  in the wallet SDK's `availableCoins`, which the DApp Connector doesn't
  expose. A `receiveShielded` argument describes the output the transaction
  creates for the contract, so the UI passes a fresh coin (random nonce) and
  the wallet funds it from the chips it holds, adding change when its coin is
  bigger. That also gives every escrowed coin a nonce the issuer never saw,
  which the Node test gets from `splitShieldedCoin`.
- **The escrow's Merkle index.** The table never stores a player's escrowed
  coin, so the player's browser keeps it (encrypted private state) and
  replays it to claim or forfeit, with its `mt_index`: the bet tx's
  `zswapStartIndex` (from the indexer) plus the escrow output's position in
  that tx, found by its commitment. The position isn't always 0: on the
  devnet, a 100-chip bet paid from a 150-chip coin put the change output first.
- **Minting to a player.** A mint needs the player's coin key and their
  encryption key (without it their wallet never finds the coin). Players
  copy their shielded address (`mn_shield-addr_…`, which carries both) from
  the page and send it to the house.
- **Pre-checks.** Role (house or player) and every bet/claim/forfeit
  pre-check come from pure helpers that
  `src/__tests__/shielded-chips-circuits.test.ts` checks against the real
  compiled circuits, in memory, over a full round.

The fresh-coin arguments (houseDeposit, betColor with and without change,
burn) and the escrow index were checked with the Node harness on the local
devnet before any of this was built. The browser and wallet runs are recorded
in `verification.json`.

## Run

```bash
yarn workspace @midnight-ntwrk/example-shielded-chips run compile   # contracts first
cd examples/shielded-chips && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-shielded-chips-ui dev           # http://localhost:5173
```

On the local devnet, give each browser wallet DUST (and NIGHT) with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, run from anywhere in the repo. The
page prints the exact command when the connected wallet has no DUST.

### Playing a round

You need two wallets: the house can't bet. Use two browser profiles, each
with its own wallet account, and one passphrase per profile for the encrypted
private state.

1. **House:** connect, unlock, then in step 1 click **Deploy chips token**,
   pick a winning number (or keep the random one) and **Deploy table**. Copy
   the table address to the player.
2. **Player:** connect, unlock, paste the table address and **Join**. Copy
   **Your shielded address** to the house.
3. **House:** mint chips to the player's address, and to yourself (**Me**)
   for match coins. **Deposit** one match coin per expected winning bet, of
   the same value.
4. **Player:** once the chips show in **Your chips**, bet on RED or BLACK.
5. **House:** **Reveal**.
6. **Player:** **Claim 2x** if you won, or **Forfeit** to the house.
7. **House:** sweep what's left in the pool.

Don't clear site data mid-round: the player's escrowed coin and both keys
live only in this browser's encrypted store, and there's no recovery.

### Mainnet

This UI opts into mainnet (`"networks": ["mainnet"]` in `new-ui.json`), so
`mainnet` is in the network picker. Before you use it:

- **It costs real DUST.** Two deploys, then every mint, deposit, bet, reveal,
  claim and sweep pays fees in DUST, generated from NIGHT each wallet holds.
  There is no faucet. Chips themselves are worthless.
- **Everything public is permanent.** Both contracts and their ledgers stay on
  mainnet: bet colors and values, the pool, the commitments. Coins, keys, and
  which wallet placed which bet stay private.
- **Prove with a proof server you run yourself** (`yarn proof:up` in
  `examples/shielded-chips`, proof server 8.1.0), or with the wallet if it
  supports `getProvingProvider`. Never a hosted one: it sees your keys and
  coins. The burn circuits' prover keys are about 20 MB each.
- **Use your own wallets.** Never use the repo's fast-sync or seeded test
  wallets (`.env.<network>`, `yarn wallets:new`) on mainnet.
- **One round per table.** Betting never reopens; deploy a new table for
  another round (the chips token can be reused).

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |

## TODO: end-to-end verification with a wallet

- [ ] Local devnet, two profiles: the full round above, in both proving modes.
- [ ] Reload mid-round (after the bet): passphrase, re-join, claim still works.
- [ ] A wrong passphrase is refused.
- [ ] Mainnet: the full round with small amounts.
