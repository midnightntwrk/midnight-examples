# __Title__ UI

<!-- @if monorepo -->
Browser frontend for `examples/__name__`: connect a Midnight wallet,
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `yarn new:ui __name__` from `packages/mnkit/templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.
<!-- @endif -->
<!-- @if standalone -->
Browser frontend for __name__: connect a Midnight wallet, deploy or join
the contract, watch its public ledger, and call its circuits.

Scaffolded by `mnkit add ui`. See `AGENTS.md` next to this file for which
files are template-owned and which are yours, and for the verification
checklist.
<!-- @endif -->

TODO: describe what this UI adds on top of the scaffold.

<!-- @if monorepo -->
## Run

```bash
yarn workspace @midnight-ntwrk/example-__name__ run compile   # contract first
cd examples/__name__ && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-__name__-ui dev           # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, run from anywhere in the repo. The
page prints the exact command when the connected wallet has no DUST.

<!-- @endif -->
<!-- @if standalone -->
## Run

```bash
npm run compile                        # the contract, with its proving keys
npm run env:up && npm run wait:dust    # local devnet
npm run dev --workspace ui             # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`npm run fund:wallet <mn_dust_…> [mn_addr_…]`, run in the project. The page
prints the exact command when the connected wallet has no DUST.

<!-- @endif -->
## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
