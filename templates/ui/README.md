# __Title__ UI

Browser frontend for `examples/__name__`: connect a Midnight wallet,
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `yarn new:ui __name__` from `templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

TODO: describe what this UI adds on top of the scaffold.

## Run

```bash
yarn workspace @midnight-ntwrk/example-__name__ run compile   # contract first
cd examples/__name__ && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-__name__-ui dev           # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, run from anywhere in the repo. The
page prints the exact command when the connected wallet has no DUST.

## Indexer

The UI reads public data from the indexer configured in the connected wallet.
If that indexer is wrong or has been shut down (deploys fail with
`Failed to fetch`), override it without touching the wallet:

```bash
cp .env.example .env.local   # in this ui/ directory; .env.local is gitignored
# uncomment and fill in VITE_INDEXER_URI and VITE_INDEXER_WS_URI, then restart `yarn dev`
```

Set both or neither, and use an indexer on the wallet's network. Blockfrost
needs your project id in both URLs (`?project_id=<key>`).

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
