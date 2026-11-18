# Dependency pins: why they're there

Root `AGENTS.md` says to leave these pins alone. This page says why. Like the
rest of the toolchain, they move only in a coordinated repo-wide version pass.

## The hoisted `vite` is 6.x, set by `examples/zk-loan/ui`

That UI uses upstream's Vite 6 toolchain, and npm hoists it to the root, so
every example's `vitest.config.ts` gets Vite 6.4.3 for its bare
`import { loadEnv } from 'vite'`. vitest itself still runs on its own nested
Vite 8.

This is intentional for now: containing Vite 6 to the UI breaks it (see
`examples/zk-loan/ui/README.md`). Do not "fix" it by pinning Vite 8 at the
root. The Vite 8 move is a TODO for the next coordinated version pass.

## The root `devDependencies` pins `bn.js` 5.2.5

It anchors a single `bn.js@5` at `node_modules/`. Without it, the `zk-loan/ui`
browser polyfills (`vite-plugin-node-polyfills` → `crypto-browserify` →
`elliptic`, `asn1.js`, …) hoist `bn.js@4` to the root, and the wallet SDK's
node client and `@polkadot/util` each get a private `bn.js@5` copy. Every
transaction submit then fails with `SubmissionError` (`blockNumber: Expected
BN, actual N`) even though the tx lands, followed by `DustDoubleSpend` on the
next one.

Do not remove it; `bn.js@4` stays nested under the polyfill packages.

## The root `overrides` pin `vite-plugin-top-level-await` → `uuid` to 11.1.1

The plugin (1.6.0, latest) pins `uuid` exactly at 10.0.0, which Trivy flags
(CVE-2026-41907, fixed in 11.1.1). It only calls `require("uuid").v5`, which
11.x keeps. Drop the override once the plugin widens its range.
