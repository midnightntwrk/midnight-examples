# q3-ledger9: Q3 2026 acceptance tests on the ledger 9 stack

These are Foundation acceptance tests for the two "easy to test here" Q3 deliverables in
[`../q3-delivery/q3-testing-strategy.md`](../q3-delivery/q3-testing-strategy.md):

| Deliverable | What we test | Where |
|---|---|---|
| **SOW-Q3-01** Crypto schemes | `ed25519Verify` and `secp256r1EcdsaVerify` in Compact, and the gaps vendor QA left open, in DApp shape | [`signature-verify/`](signature-verify/) |
| **SOW-Q3-03** Multi-contract systems 2 | Dynamic cross-contract calls (CoIP 4) through the published Midnight.js `5.0.0-rc.2` module provider | [`dynamic-calls/`](dynamic-calls/) |

The tests target gaps, not duplicates. Vendor QA (compact-end-2-end) already proves the
features case by case. These tests aim at the gap rows (`01-G*`, `03-G*`) in the strategy
doc, and each test name carries the gap ids and AC ids it covers.

## Why a separate Yarn project

mn-examples is pinned to the **ledger 8** stack: compactc 0.31.1, Midnight.js 4.1.1, and
wallet SDK 1.2.0. Those examples are also the pre-fork DApps the hard-fork rehearsal
(SOW-Q3-08) needs. A version move in mn-examples has to be a coordinated, repo-wide pass
(`AGENTS.md`).

This directory is its own Yarn project instead: its own `package.json`, `yarn.lock` and
`.yarnrc.yml`. It sits outside the root workspaces, so nothing here changes the root
install. `yarn stack:check` fails if any pinned package resolves from the parent
`node_modules`.

## Stack

| Component | Version | Source |
|---|---|---|
| Compact toolchain | 0.35.0 (language 0.27.0, runtime 0.20.0) | record |
| Ledger | `@midnightntwrk/ledger-v9` 1.0.0-rc.5 | record |
| On-chain runtime | `@midnightntwrk/onchain-runtime-v4` **4.0.0-rc.4** (pinned by `resolutions`) | record. Vendor QA ran rc.3 (gap 01-G11) |
| Compact.js / Platform.js | 3.0.0-rc.3 / 3.0.0 | record |
| Midnight.js, testkit-js | **5.0.0-rc.2** | The record lists rc.1. rc.2 is the first release with the module provider SOW-Q3-03 needs |
| Wallet SDK | 2.0.0-rc.0 (`@midnightntwrk/wallet-sdk-*`) | record |
| Node image | `midnightntwrk/midnight-node:2.1.0-rc.3` | record; digest matches |
| Indexer image | `ghcr.io/midnightntwrk/indexer-standalone:4.4.0-rc.6-068403cd` | record's tag and digest; **org corrected** (finding 10) |
| Proof server image | `midnightntwrk/proof-server:9.0.0-rc.8` | record; digest matches |

`compose.yml` publishes these images on host ports 19944, 18088 and 16300, which are the
mn-examples ports plus 10000, so a ledger 8 example network can run at the same time.

## Setup

```bash
nvm use 22                                   # or newer; engines >=22.12
compact update --no-set-default 0.35.0       # installs 0.35.0, keeps 0.31.1 the default
cd experimental/q3-ledger9
yarn install                                 # its own lockfile
yarn stack:check                             # every pin resolved locally, compiler, image digests
```

## Running

```bash
yarn compile        # all contracts; the vector contracts always use --skip-zk
                    # (Q3_SKIP_ZK=1 yarn compile skips keys everywhere: enough for test:sim)
yarn test:sim       # L1: in memory, no network. Seconds.

yarn env:up && yarn wait:dust
yarn test:local     # L2: deploy and call on the local network, real proofs. Minutes.
yarn env:down

yarn report         # runs sim + e2e; writes reports/sow-q3-0N-local-<date>.json and .md
yarn report:md      # re-render the .md from existing JSON (preliminary notice included)
yarn report sim     # L1 only
```

Compiling `signature_auth` with keys takes about 1.5 minutes and writes about 720 MB of
proving keys: each verify circuit is 220–290 MB. That is why the test-vector contracts
have only pure circuits and never get keys.

## Layers

| Layer | What runs | Files |
|---|---|---|
| **L1 `sim`** | Pure circuits from the generated `pureCircuits`, and whole contracts in the compact-runtime simulator ([`harness/src/sim.ts`](harness/src/sim.ts)). For SOW-03 this includes cross-contract calls in memory: a `ContractStateProvider` stands in for the chain and real verifier keys are loaded into the callee state. | `*.sim.test.ts` |
| **L2 `e2e`** | Midnight.js 5 deploy and `submitCallTx` against `compose.yml`, with proofs from proof server 9.0.0-rc.8 and state read back through the indexer | `*.e2e.test.ts` |

Vendor QA runs only at L2, plus refusals before a circuit runs, so L1 is new coverage.

## Coverage

**SOW-Q3-01** (`signature-verify/`)

| Gap | Test | Layer |
|---|---|---|
| AC-1 | RFC 8032 TEST 1/2/SHA(abc), Cardano mainnet vkey witness, wrong key and altered messages | L1 |
| AC-2 | RFC 6979 A.2.5, a real YubiKey WebAuthn signature, `s+1`, another message, wrong key | L1 |
| 01-G1 | identity P-256 key is refused by assertion | L1 |
| 01-G2 | `verify_digest_UNSAFE` "verifies" an action the signer never saw; the in-circuit-digest form refuses it | L1 |
| 01-G3 | raw verify accepts both `(r, s)` and `(r, n-s)`; the contract-level `verify_low_s` accepts low-s only | L1 |
| 01-G4 | off-curve key, `r=0`, `s=0`, `r=n`, `s=n`, `s+n` are never accepted (see observations) | L1 |
| 01-G5 | `passkey_action`: challenge, origin, type, RP and UP checked in-circuit; challenge rotates; replay, phishing origin, `webauthn.create`, wrong RP, UP clear and wrong device are refused | L1, L2 |
| 01-G7 | `ed25519Verify<0>` (RFC 8032 TEST 1) and `<1023>` | L1 |
| 01-G8 | `persistentHash<Bytes<N>>` equals node:crypto SHA-256 | L1 |
| 01-G9 | `authorize_private`: key and signature come from witnesses, bound to a public commitment | L1, L2 |
| 01-G10 | `authorize_once`: replay refused | L1, L2 |
| 01-G11 | runs on onchain-runtime 4.0.0-rc.4 (`yarn stack:check`) | all |
| 01-G6 | Solana vector: **not done** (optional; Ed25519 is the same algorithm) | — |

**SOW-Q3-03** (`dynamic-calls/`)

| Gap | Test | Layer |
|---|---|---|
| AC-1 | the single `pay` call site runs standard code for one address and audited code for another; only the audited counter moves | L1, L2 |
| 03-G1 | no provider: `ModuleProviderAbsent` | L1, L2 |
| 03-G2 | unbound address: `UnsupportedImplementation` | L1, L2 |
| 03-G3 | the standard module bound to the audited address: `ImplementationMismatch` | L1, L2 |
| 03-G4 | a module without `transfer`: `NonconformantImplementation` | L1 |
| 03-G5 | `ProviderThrew`, `ModuleLoadRejected`, `IncompleteModule`, `MalformedVerifierKeyHash`, `OperationAbsent` | L1 |
| 03-G6 | `discoverByVerifierKey` maps addresses to modules from on-chain verifier keys (indexer at L2), and leaves unknown code unbound; `deferredProvider` does the lookup inside the thunk | L1, L2 |
| 03-G7 | `swap` runs both implementations in one transaction | L1, L2 |
| 03-G9 | cross-contract calls in memory | L1 |
| 03-G10 | generated modules carry `declaredInterfaces` / `circuitSignatures` / `expectedVk`; same signature, different fingerprints | L1 |
| 03-G8 | verifier-key change at an address: **not done** (stretch) | — |

Two of the eleven `ModuleResolutionError` kinds are not driven: `PureInterfaceCircuit` and
`UnreadableModule`.

## Observations and findings

These are results of the runs recorded in `reports/`. Latest run, 2026-10-01: SOW-01 L1 50/50, L2 6/6; SOW-03 L1 16/16, L2 6/6, on the record's images, digests verified. They are what we saw happen; we did
not assume any of them in advance.

| # | Observation | Status |
|---|---|---|
| 1 | compactc 0.35.0 still needs `--feature-zkir-v3` for the Curve25519 and secp256r1 types and both verify circuits; ZKIR v2 is the default | confirmed (`--help`, toolchain notes) |
| 2 | How a hostile P-256 input is refused depends on the input: identity key, **failed assertion**; off-curve key or `r`/`s` ≥ n, **type error** before the circuit runs; `r = 0`, **returns `false`**; `s = 0`, **throws "secp256r1 scalar field has no inverse for 0"** (an arithmetic error, not an assertion) | L1. Whether `s = 0` behaves the same when proven is still open: no L2 test drives it |
| 3 | Ed25519: identity key gives a failed assertion; off-curve, small-order key and non-canonical `s + L` are refused before the circuit runs | L1 |
| 4 | `Secp256r1Scalar` has no `<`, and `Uint<128>` cannot be cast to it directly; going through `Bytes<32>` works and keeps the value | L1 (`verify_low_s`) |
| 5 | WebAuthn: rebuilding clientDataJSON from constants plus the stored challenge works. Real browsers may add keys or reorder them, which a fixed layout refuses | design limitation |
| 6 | A cross-contract **caller compiles with no callee source beside it**; only its `contract Token { … }` declaration is needed. compact-end-2-end's "callee managed dir named after the interface" convention predates 0.35 | confirmed |
| 7 | `ContractModuleProvider.resolve` is synchronous, so an online lookup must either be done ahead of time (`discoverByVerifierKey`) or deferred into the thunk (`deferredProvider`). The two fail differently: `UnsupportedImplementation` vs `ModuleLoadRejected` | confirmed |
| 8 | CoIP 4 (@ca9da303) lists 10 failure kinds; compact-runtime 0.20.0 has 11, including `PureInterfaceCircuit` | spec drift to raise |
| 9 | The Midnight.js v5.0.0-rc.2 migration guide does not mention `contractModuleProvider` | doc gap to raise |
| 10 | **The record's indexer image path names the wrong org.** It and compact-end-2-end's `infra/pins.ts` write `ghcr.io/midnight-ntwrk/indexer-standalone`. ghcr refuses that path (401 anonymous, 403 logged in with `read:packages`), and the GitHub packages API reports no such package under `midnight-ntwrk`. The image is **public** at `ghcr.io/midnightntwrk/indexer-standalone` (no hyphen), with the record's digest `sha256:5c717d83…2d64458`. Docker Hub stops at `4.4.0-rc.2` | doc error to raise; fixed in `compose.yml` |
| 11 | Yarn 4.18's default 24-hour minimum package age quarantines release candidates on the day they ship. Fixed here by preapproving only the two first-party Midnight scopes in `.yarnrc.yml` | workaround |
| 12 | `from` and `to` are reserved words in Compact and cannot be parameter names | minor |

## Layout

```
compose.yml            local ledger 9 network (pinned images, offset ports)
harness/               @q3/harness: config, wallet (testkit-js 5), providers, simulator,
                       stack check, report writer, a counter smoke test (L2 gate)
signature-verify/      SOW-Q3-01: contracts, fixtures (each one checked with @noble/curves
                       before use), sim and e2e tests
dynamic-calls/         SOW-Q3-03: two Token implementations, the registry, module
                       providers, sim and e2e tests
reports/               generated acceptance reports
```

## Later: CI

CI is out of scope for now. If it is added, it should be a separate job:
- `setup-compact-action` with `compact-version: '0.35.0'`
- `working-directory: experimental/q3-ledger9`
- its own `yarn install --immutable`
- `Q3_SKIP_ZK=1 yarn compile && yarn test:sim`

That is L1 only: no keys, no network, under a minute. L2 needs about 720 MB of keys, so it suits a manual or nightly run.
