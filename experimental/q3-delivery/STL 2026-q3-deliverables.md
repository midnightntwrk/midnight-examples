# Shielded Q3 2026 deliverables

## Summary

This quarter delivered new Compact capabilities (signature verification, dynamic cross-contract calls, and in-circuit proof verification), the ledger 8 to 9 hard fork, two node prototypes (BABE block production and block production rewards), and proposal work across four items. Features are delivered at pre-release versions so the Foundation can test them now, ahead of 2026-Q3-Release-1.

### Notes

- SOW-Q3-02 runs on Ledger 10 alpha components; it cannot run on the ledger 9 stack.
- SOW-Q3-05 and SOW-Q3-06 are prototypes on feature branches of the unreleased node 3.0.0.
- Examples and run books copied into the item folders are snapshots at the commit named on each; the source repositories stay canonical.

### What's next

- Final component versions ship with [2026-Q3-Release-1](../../bundles/2026-q3-release-1/2026-q3-release-1.md), with their checksums in its release note under [Artefact checksums](../../bundles/2026-q3-release-1/2026-q3-release-1.md#artefact-checksums).
- SOW-Q3-08 proceeds through qanet, preview, and preprod towards the mainnet fork.
- SOW-Q3-02 moves onto a released stack once Ledger 10 ships.
- The proposals continue through the MIP process. SOW-Q3-04 is implemented over later quarters. BABE hybrid operation continues in phase 2.

## Deliverables

| ID | Deliverable | Class | Components | Folder |
| --- | --- | --- | --- | --- |
| [SOW-Q3-01](#sow-q3-01-crypto-schemes) | Crypto schemes: ed25519 and ECDSA over P256 | feature | Compact, Ledger | [`sow-q3-01-crypto-schemes/`](sow-q3-01-crypto-schemes/) |
| [SOW-Q3-02](#sow-q3-02-recursive-proofs) | Proof verification in Compact phase 1: recursive proofs | feature | midnight-zk, Compact, Ledger | [`sow-q3-02-recursive-proofs/`](sow-q3-02-recursive-proofs/) |
| [SOW-Q3-03](#sow-q3-03-multi-contract-systems-phase-2) | Multi-contract systems 2: dynamic cross-contract calls | feature | Compact, Ledger, Midnight.js | [`sow-q3-03-multi-contract-systems-2/`](sow-q3-03-multi-contract-systems-2/) |
| [SOW-Q3-04](#sow-q3-04-multi-contract-systems-phase-3) | Multi-contract systems 3: private state | MIP | not applicable | [`sow-q3-04-private-state/`](sow-q3-04-private-state/) |
| [SOW-Q3-05](#sow-q3-05-babe-phase-1) | Decentralisation: Babe phase 1 beta | prototype | Node | [`sow-q3-05-babe-phase-1/`](sow-q3-05-babe-phase-1/) |
| [SOW-Q3-06](#sow-q3-06-block-production-rewards) | Block production rewards | MIP and prototype | Node, with Cardano-side reserve contracts | [`sow-q3-06-block-production-rewards/`](sow-q3-06-block-production-rewards/) |
| [SOW-Q3-07](#sow-q3-07-shielded-source-of-funds) | Shielded source of funds | time and materials | not applicable | [`sow-q3-07-shielded-source-of-funds/`](sow-q3-07-shielded-source-of-funds/) |
| [SOW-Q3-08](#sow-q3-08-hard-fork-v8-to-v9) | Hard fork: Ledger v8 to v9 migration | feature | Ledger, Node, Indexer, Platform.js, Midnight.js, Wallet SDK | [`sow-q3-08-hard-fork-v8-v9/`](sow-q3-08-hard-fork-v8-v9/) |
| [SOW-Q3-09](#sow-q3-09-throughput-performance) | Throughput performance | time and materials | not applicable | [`sow-q3-09-throughput-performance/`](sow-q3-09-throughput-performance/) |

## Component versions

The features are delivered against this ledger 9 stack, at the versions in use today. Each version links to its release note where one exists, otherwise to its tag, source commit, or image. Those carry the breaking changes, migration steps, and security-relevant changes.

SHA-256 is for the distributable artefact: the registry digest where a container image is what an operator runs, otherwise the release asset or the published npm tarball. Components with more than one artefact list every file under the table.

| Component | Version | Tag @ source commit | SHA-256 |
| --- | --- | --- | --- |
| Ledger | [`9.1.0.0-rc.5`](https://github.com/midnightntwrk/midnight-ledger/releases/tag/ledger-9.1.0.0-rc.5) | `ledger-9.1.0.0-rc.5` @ `67f9f97` | `bd7546922af1a020b057754d8abd36f833374c04e7bdf3e12338a4043486db62` (`midnight-ledger-v9-1.0.0-rc.5.tgz`) |
| Node | [`2.1.0-rc.3`](https://github.com/midnightntwrk/midnight-node/releases/tag/node-2.1.0-rc.3) | `node-2.1.0-rc.3` @ `47c6708` | `sha256:0e0eeaaacb3cef76d8da9f4a4827d5239e3592d669a8a88283ad373f0354a1bf` (image), release assets listed under the table |
| Indexer | [`4.4.0-rc.6-068403cd`](https://github.com/midnightntwrk/midnight-indexer/tree/068403cd0eb6caac36f9b34431f7e5c1cadb759a) | untagged build @ `068403c` | `sha256:5c717d839d48665bb2067b23b7c1e9e6b7d4c4e9cbaeef130a8c23ded2d64458` (`indexer-standalone` image), other images listed under the table |
| ZKIR | [`3.1.0-rc.1`](https://github.com/midnightntwrk/midnight-zkir/tree/zkir-3.1.0-rc.1) | `zkir-3.1.0-rc.1` @ `e82d81d` | ships as the `zkir-v3` binary inside the Compact toolchain archives, listed under the table |
| Proof server | [`9.0.0-rc.8`](https://github.com/midnightntwrk/midnight-ledger/releases/tag/proof-server-9.0.0-rc.8) | `proof-server-9.0.0-rc.8` @ `3361066` | `sha256:2666c7bd7b4517f8ad135565387f98d14347a9ac715c6c466d4a8a852b545ecf` (image) |
| Compact toolchain | [`0.35.0`](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.35.0) | `compactc-v0.35.0` @ `debb05f` | four platform archives, listed under the table |
| Compact runtime | [`0.20.0`](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.35.0) | `compactc-v0.35.0` @ `debb05f` | `08ab34e2e0bacb433ddde6ab62c7cfb77dc0a887c811fdca5625c93b676f0369` (`compact-runtime-0.20.0.tgz`) |
| On-chain runtime | [`4.0.0-rc.4`](https://github.com/midnightntwrk/midnight-ledger/tree/onchain-runtime-4.0.0-rc.4) | `onchain-runtime-4.0.0-rc.4` @ `f1683fd` | `1803b70b41d6df1d16d8a9784bccdc33af2365af860cd2ae7ed528e42811fb81` (`onchain-runtime-v4-4.0.0-rc.4.tgz`) |
| Compact.js | [`3.0.0-rc.3`](https://github.com/midnightntwrk/midnight-sdk/releases/tag/compact-js-v3.0.0-rc.3) | `compact-js-v3.0.0-rc.3` @ `b465811` | `88ba4fd217aa1ae336a6d1154c65f78fff390b0abf4e0fdc08e186a3ae82e1b6` (`compact-js-3.0.0-rc.3.tgz`) |
| Platform.js | [`3.0.0`](https://www.npmjs.com/package/@midnight-ntwrk/platform-js/v/3.0.0) | npm `@midnight-ntwrk/platform-js@3.0.0` | `bc106bc69edd4b108b01ca7b20d8f249addc41ec1259447ea86be994535abd11` (`platform-js-3.0.0.tgz`) |
| Wallet SDK | [`2.0.0-rc.0`](https://github.com/midnightntwrk/midnight-wallet/releases/tag/%40midnightntwrk/wallet-sdk%402.0.0-rc.0) | `@midnightntwrk/wallet-sdk@2.0.0-rc.0` @ `73e0b1a` | `5c43bee409f9bb660abf19e6e8b1d71d5a5c6bc0c8b14a18a863f07ed04c7973` (`wallet-sdk-2.0.0-rc.0.tgz`) |
| Midnight.js | [`5.0.0-rc.1`](https://github.com/midnightntwrk/midnight-js/releases/tag/v5.0.0-rc.1) | `v5.0.0-rc.1` @ `cc70e04` | fourteen npm packages, listed under the table |

<details>
<summary>Every artefact, in <code>shasum -a 256 -c</code> format</summary>

```text
# Ledger 9.1.0.0-rc.5, GitHub release assets
bd7546922af1a020b057754d8abd36f833374c04e7bdf3e12338a4043486db62  midnight-ledger-v9-1.0.0-rc.5.tgz

# Node 2.1.0-rc.3, GitHub release assets
f8e24e0a0976c53b654ffee1d173364da5e9928bc285d6aeff5cf4b551c67ee5  midnight-node-2.1.0-rc.3-linux-amd64.tar.gz
f8631691ee693c1e2ddf4a2e882042f5e74f78c24cd18683c32862d51b0a02a8  midnight-node-2.1.0-rc.3-linux-arm64.tar.gz
d885c83f03af5d3b83746cd98cbe1823257cc53c4f5b790245e7a555ce0d9229  midnight-node-toolkit-2.1.0-rc.3-linux-amd64.tar.gz
635febab711f0660d6071a59dea50bb6e91e3d1a9d39eeb2a5ce2f55fdf142a6  midnight-node-toolkit-2.1.0-rc.3-linux-arm64.tar.gz
6a9bc0d871933a19e8cd109dedb2c90f6a4047a936d29e565f8a8132b49fe647  midnight_node_runtime-2.1.0-rc.3.compact.compressed.wasm
a1a460f71b4d9ea72051e8d0e9e30049e24b7df7d785d57b3f7e197d0940fb96  midnight_node_runtime-2.1.0-rc.3.compact.wasm
eefb7d361c343729473f8b4aea27175f3eb6d97d0e6f7abb7b3f41675d3833b8  midnight_node_runtime-2.1.0-rc.3.wasm

# Compact toolchain 0.35.0, GitHub release assets
5898b3d916b2b26f2c110b55a4a4121c22c88eefbd076994e8c3dd3e56c571fc  compactc_v0.35.0_aarch64-darwin.zip
3f74ec6fc98ccca7365c5c915f6015d8893db4527faafe04a90bc36effc40a3a  compactc_v0.35.0_aarch64-unknown-linux-musl.zip
adfd3738965d758897d8038b86a5c32e5bd20fb437fc0f1cbc01c8d816b0e212  compactc_v0.35.0_x86_64-darwin.zip
70f22fb8209cc5a8504b2b3d91796cfdab2d71d88807ceef12fab87fed03bae2  compactc_v0.35.0_x86_64-unknown-linux-musl.zip

# npm tarballs, @midnight-ntwrk scope
08ab34e2e0bacb433ddde6ab62c7cfb77dc0a887c811fdca5625c93b676f0369  compact-runtime-0.20.0.tgz
1803b70b41d6df1d16d8a9784bccdc33af2365af860cd2ae7ed528e42811fb81  onchain-runtime-v4-4.0.0-rc.4.tgz
88ba4fd217aa1ae336a6d1154c65f78fff390b0abf4e0fdc08e186a3ae82e1b6  compact-js-3.0.0-rc.3.tgz
bc106bc69edd4b108b01ca7b20d8f249addc41ec1259447ea86be994535abd11  platform-js-3.0.0.tgz
5c43bee409f9bb660abf19e6e8b1d71d5a5c6bc0c8b14a18a863f07ed04c7973  wallet-sdk-2.0.0-rc.0.tgz
e892ae53d4d27bedbfce24b2e02632c4130e53a66e951a61aa59ffbae22bea33  midnight-js-5.0.0-rc.1.tgz
722dd3f56ed03e0641f4456c82b284c846575f0b85df755afe4cabf27f3690ee  midnight-js-contracts-5.0.0-rc.1.tgz
fdfe282d239c96dfe330828484d79eecd0b73be95e20bd48c66338d93decfa33  midnight-js-compact-5.0.0-rc.1.tgz
8eaed444d488d3978c1dbe184449ae15cb06c5d8a62c535425bda26a2ba53cbb  midnight-js-dapp-connector-proof-provider-5.0.0-rc.1.tgz
cdac19b1dbeadaf8eeb76936479f2a56d1560f5a6d77de9d4fb5a2dfc3250a0d  midnight-js-fetch-zk-config-provider-5.0.0-rc.1.tgz
f08d4b41be5752131cd6c4e8a9d587dafc81764460afbf3382d8237c347af632  midnight-js-http-client-proof-provider-5.0.0-rc.1.tgz
0dd76903d42d0d986acd57b74d33674153d7d06c66a8b3ea0ea3e7bf99d57b87  midnight-js-indexer-public-data-provider-5.0.0-rc.1.tgz
b5a3852968580c0ab3a02b43a200e486658f00a20a5073b4f90b5c5485f90c51  midnight-js-level-private-state-provider-5.0.0-rc.1.tgz
466bdada60a998bf2e53b35c3472178abb2da7c915d4444b27720e981ab0cdc8  midnight-js-logger-provider-5.0.0-rc.1.tgz
d09389e77ddbb5297a50ff03e2ef49da7b303e246d13d17e3ee24a707cb8fcfa  midnight-js-network-id-5.0.0-rc.1.tgz
304c6033f12b9b2db81ad717de70b85028e482ed5ccda135bd9967e98b561665  midnight-js-node-zk-config-provider-5.0.0-rc.1.tgz
751947abfa0b95a1d01c62a30bcb96dfb6fa1590c228f08954df0bf009c0cd2b  midnight-js-protocol-5.0.0-rc.1.tgz
246430cef7f3345688b4bc96c11102e8b1d0a1c278876c3fdd6f62f13c6321a0  midnight-js-types-5.0.0-rc.1.tgz
723ce37bb007843c73a4828298c7265a6f22d81ecb3838889213274ba2558272  midnight-js-utils-5.0.0-rc.1.tgz
```

Container images, as registry digests: `midnightntwrk/midnight-node:2.1.0-rc.3`
`sha256:0e0eeaaacb3cef76d8da9f4a4827d5239e3592d669a8a88283ad373f0354a1bf`,
`midnightntwrk/proof-server:9.0.0-rc.8`
`sha256:2666c7bd7b4517f8ad135565387f98d14347a9ac715c6c466d4a8a852b545ecf`.
Indexer images, `ghcr.io/midnightntwrk/<image>:4.4.0-rc.6-068403cd`, as multi-architecture registry digests:

```text
sha256:5c717d839d48665bb2067b23b7c1e9e6b7d4c4e9cbaeef130a8c23ded2d64458  indexer-standalone
sha256:64a852482394539eba2883b737b7e6ec559a503439aa0e379c1578a52b8f59f7  chain-indexer
sha256:2cbd155cbd0f886ec195b14e86a09883119c33b56a329215a04c63aee5623f7a  indexer-api
sha256:b34c0a413a3b209080dea982464cb41f1e51cf4f2efd7cca6a0c949ede4995f1  wallet-indexer
```

Verify with `docker buildx imagetools inspect <image:tag>`.

</details>

## Deliverable records

### SOW-Q3-01 Crypto schemes

Crypto schemes: ed25519 and ECDSA over P256. Compact contracts can now verify Ed25519 signatures (RFC 8032) and ECDSA signatures over P-256 inside a circuit, via the new standard-library circuits ed25519Verify and secp256r1EcdsaVerify. This lets a contract check signatures from ecosystems built on these curves, such as Solana, Cardano and WebAuthn/passkeys, alongside the existing secp256k1 support. Both schemes land together in [compact#793](https://github.com/LFDT-Minokawa/compact/pull/793).

- **Test evidence:** [`sow-q3-01-crypto-schemes/test-evidence/sow-q3-01-crypto-schemes-qa-test-evidence.md`](sow-q3-01-crypto-schemes/test-evidence/sow-q3-01-crypto-schemes-qa-test-evidence.md), QA suite PASS on 2026-09-30: Ed25519 4 of 4 cases, 42 of 42 tests; ECDSA over P-256 4 of 4 cases, 21 of 21 tests. Run on the Component versions stack, with the on-chain runtime at 4.0.0-rc.3, the version the stack's npm packages pin
- **Example:** [`sow-q3-01-crypto-schemes/examples/ed25519-demo.md`](sow-q3-01-crypto-schemes/examples/ed25519-demo.md), RFC 8032 vectors and a Cardano wallet signature; [`sow-q3-01-crypto-schemes/examples/secp256r1-demo.md`](sow-q3-01-crypto-schemes/examples/secp256r1-demo.md), an RFC 6979 vector and a YubiKey signature; each verified in a Compact contract
- **Demo:** three narrated recordings, Ed25519, ECDSA over P-256 and a YubiKey signature, in the [shared folder](https://drive.google.com/drive/folders/1D-TblWGi6362Bhcm8Qagqt2o6YM2aKF-); the Ed25519 and P-256 recordings built from [compact-end-2-end@2fefc2b](https://github.com/midnightntwrk/compact-end-2-end/commit/2fefc2b9e2ff5d0fd177e7fba27cf3ada1510857), the YubiKey recording from [compact-end-2-end@672bc50](https://github.com/midnightntwrk/compact-end-2-end/commit/672bc50c6748aed80d765bbb8f7df950fada9bbe). Transcripts: [Ed25519, a Cardano wallet signature](sow-q3-01-crypto-schemes/sow-01-ed25519-2fefc2b9e2ff5d0fd177e7fba27cf3ada1510857.md), [P-256, the RFC 6979 vector](sow-q3-01-crypto-schemes/sow-01-secp256r1-2fefc2b9e2ff5d0fd177e7fba27cf3ada1510857.md), [YubiKey, a WebAuthn signature hashed in-circuit](sow-q3-01-crypto-schemes/sow-01-yubikey-672bc50c6748aed80d765bbb8f7df950fada9bbe.md). The P-256 recording shows the contracts at `2fefc2b`, which take the digest as a circuit argument and use the low-s form of the RFC signature. The example at [`672bc50`](https://github.com/midnightntwrk/compact-end-2-end/commit/672bc50c6748aed80d765bbb8f7df950fada9bbe) computes the digest in-circuit and uses the RFC's own signature. The YubiKey recording shows the contract at `672bc50`. The second vector is rejected because the signed bytes differ once the origin is changed; the contract does not check the origin itself
- **Security note:** secp256r1EcdsaVerify takes a 32-byte digest and does not bind it to any message. The examples take the message and compute the digest in-circuit, as a production contract must for the message it authorises. The YubiKey example hashes the client data and the authenticator data in-circuit but does not read them, so it does not check the challenge. A passkey or WebAuthn contract must also check the challenge. Ed25519 is not affected: ed25519Verify hashes the message in-circuit.

Acceptance criteria:

- AC-1: ed25519 signatures can be verified in Compact
- AC-2: ECDSA signatures over P256 can be verified in Compact

### SOW-Q3-02 Recursive proofs

Proof verification in Compact phase 1: recursive proofs. A Compact circuit can now verify a midnight-zk proof of a separate statement with `verifyProof(vkPath, proof, publicInputs)`, where the inner statement's verifying key is fixed at compile time. The inner proof can itself be recursive. Inner proofs are built with a Poseidon transcript; Compact's own proofs use Blake2b, so a contract cannot yet verify another Compact contract's proof. This capability is Ledger 10 dependent. See below for a compatible set of unreleased versions that allow for testing and demoing, until a Ledger 10 hardfork release is available.

- **Example:** [`sow-q3-02-recursive-proofs/examples/verify-proof-demo.md`](sow-q3-02-recursive-proofs/examples/verify-proof-demo.md), two Compact contracts that verify a simple and a recursive midnight-zk proof, with the proof-passing boundary and the Rust that creates the recursive proof
- **Demo:** two narrated recordings in the [shared folder](https://drive.google.com/drive/folders/1Ed-_LCJDhBE2oYrGPG9Ev-eVGNCSZxB_). Transcripts: [simple inner proof](sow-q3-02-recursive-proofs/sow-02-non-collapsed-400dae606da78fec850c6a72bc81e8b754c7d43f.md), [recursive inner proof](sow-q3-02-recursive-proofs/sow-02-collapsed-400dae606da78fec850c6a72bc81e8b754c7d43f.md)

Component versions for this item: the example and demo run on Ledger 10 components built from the commits below, each patched for Ledger 10, not on the ledger 9 stack above.

| Component | Version or source commit |
| --- | --- |
| Ledger | [`ledger-10.1.0.0-alpha.1`](https://github.com/midnightntwrk/midnight-ledger/releases/tag/ledger-10.1.0.0-alpha.1) (npm `@midnight-ntwrk/ledger-v10` `1.0.0-alpha.1`) |
| On-chain runtime | [`onchain-runtime-5.0.0-alpha.1`](https://github.com/midnightntwrk/midnight-ledger/tree/onchain-runtime-5.0.0-alpha.1) (npm `@midnight-ntwrk/onchain-runtime-v5` `5.0.0-alpha.1`) |
| Compact compiler | [compact@`c99f880`](https://github.com/LFDT-Minokawa/compact/commit/c99f88092d664a58c5f65c6f3a2a594da6eb524c) |
| Compact runtime | [compact@`c99f880`](https://github.com/LFDT-Minokawa/compact/commit/c99f88092d664a58c5f65c6f3a2a594da6eb524c) |
| Node | [midnight-node@`e01e41f`](https://github.com/midnightntwrk/midnight-node/commit/e01e41f83e391b5d36d30b6d62eccc19dcf0fd16) |
| Indexer | [midnight-indexer@`7a0b8d1`](https://github.com/midnightntwrk/midnight-indexer/commit/7a0b8d1e7853212e36af205c70f0436baac62606) |
| Proof server | [midnight-ledger@`a3b17c6`](https://github.com/midnightntwrk/midnight-ledger/commit/a3b17c6a5ef632790f78e7b44bef5e4ab232dbf4) |
| Compact.js and Platform.js | [midnight-sdk@`3351c28`](https://github.com/midnightntwrk/midnight-sdk/commit/3351c285dfff767affb3b7e0dc7527a1dc9edd39) |
| Midnight.js | [midnight-js@`3188f6b`](https://github.com/midnightntwrk/midnight-js/commit/3188f6bf1499f2cd4e0d26c4047d31ca66869c37) |
| ZKIR | [midnight-zkir@`39bebaa`](https://github.com/midnightntwrk/midnight-zkir/commit/39bebaaa7e9935b2d705a71f9b2d8f4d27ec1650) |
| midnight-zk crates | [`midnight-proofs` `0.8.2`](https://crates.io/crates/midnight-proofs/0.8.2), [`midnight-circuits` `7.2.4`](https://crates.io/crates/midnight-circuits/7.2.4), [`midnight-zk-stdlib` `2.3.5`](https://crates.io/crates/midnight-zk-stdlib/2.3.5), [`midnight-curves` `0.3.1`](https://crates.io/crates/midnight-curves/0.3.1), [`midnight-aggregation` `0.1.0`](https://crates.io/crates/midnight-aggregation/0.1.0) |

Acceptance criteria:

- AC-1: A recursive proof can be created in midnight-zk
- AC-2: A Compact smart contract can verify these recursive proofs

### SOW-Q3-03 Multi-contract systems, phase 2

Multi-contract systems, phase 2: dynamic selection of implementation for cross-contract calls. One of the major limitations of the prior support for multi-contract interactions was that, for each contract type defined in a Compact program, the application running the program was able to provide only a single file containing the circuit definitions for the type.

This update removes that limitation, enabling Compact programs to execute different circuit code for each contract *value*, rather than fixing a single implementation for each contract *type*.

The mechanism by which the application provides the association between contract values and implementations is quite general, supporting many styles of address resolution, ranging from a fixed, statically-known mapping to a fully dynamic, online lookup system that refers to an external registry of deployed contracts. This allows each DApp to be as extensible as it needs to be.

- **Specification:** [CoIP 4: Dynamic Selection of Implementation for Cross-Contract Calls](https://github.com/LFDT-Minokawa/compact/blob/ca9da303cf00e3ee0083acfa360a7bfd74c11746/coips/coip-0004.md)
- **Test evidence:** [`sow-q3-03-multi-contract-systems-2/test-evidence/sow-q3-03-multi-contract-systems-2-qa-test-evidence.md`](sow-q3-03-multi-contract-systems-2/test-evidence/sow-q3-03-multi-contract-systems-2-qa-test-evidence.md), QA suite PASS on 2026-09-28: 17 of 17 cases, 183 of 183 tests, Compact compiler and runtime at `b3bda7d`
- **Example:** [`sow-q3-03-multi-contract-systems-2/examples/dynamic-module-resolution.md`](sow-q3-03-multi-contract-systems-2/examples/dynamic-module-resolution.md)
- **Midnight.js:** the module provider for dynamic resolution is in [midnight-js#1307](https://github.com/midnightntwrk/midnight-js/pull/1307), not yet in a published version; the example and demo use a pre-release build from that pull request, not `5.0.0-rc.1`. Contract calls are planned for Midnight.js `5.0.0-rc.2`
- **Demo:** narrated recording in the [shared folder](https://drive.google.com/drive/folders/1JhFTwFO3pPI45qSbulrpwO3FXVELN0lc), built from [compact@b3bda7d](https://github.com/LFDT-Minokawa/compact/commit/b3bda7d1c2326adbb56e466091f1c60e3a34e8ec). Transcript: [dynamic cross-contract calls](sow-q3-03-multi-contract-systems-2/sow-03-multi-contract-systems-2-b3bda7d1c2326adbb56e466091f1c60e3a34e8ec.md)

Acceptance criteria:

- AC-1: When a circuit in contract *A* calls a circuit in contract *B*, it uses the representation of *B*'s code associated with the address at which *B* is deployed on-chain, not just the type that *A* uses to refer to all contracts like *B*. This means that the same call site can run different callee code depending on the specific value (i.e., contract address) being referred to at the time of the call.

### SOW-Q3-04 Multi-contract systems, phase 3

Multi-contract systems, phase 3: managed private state and capsule runtime (MIP). With the Compact compiler and runtime currently available, Compact programs say almost nothing about private state. All definition, evolution, protection, and recovery of private state is defined in the applications that call each contract, making it impossible for the platform to limit the leakage of private data across contract boundaries. This is a proposal describing changes to Compact and the local contract execution platform to enable well-reasoned management of private state in systems of multiple contracts.

The design described in this proposal is not yet implemented. This delivery includes only the Midnight improvement proposal (MIP) itself. The implementation of the proposed changes will be delivered across the next several quarters.

- **Proposal:** [Managed Private State and Capsule Runtime](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/334), open for review; text at [`mips/mip-xxxx.md` @ `49bbfd7`](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/49bbfd78c8a124c22404668c88ff36c7806ac9c5/mips/mip-xxxx.md)

Acceptance criteria:

- AC-1: Completed MIP submitted to the MIP process

### SOW-Q3-05 Babe phase 1

Decentralisation: Babe phase 1 beta. Phase 1 delivers a node and runtime that can move a running Midnight chain from AURA to BABE block production through governance, with no hard fork. On the runtime side, `pallet-babe` and a new `pallet-consensus-engine` handle the arm-and-flip switch; the Partner Chains generic session keys and the standard Substrate session pallet were ported in with their storage migrations; and a BABE session key was added, with keys falling back to AURA while validators transition. On the node side, Partner Chains consensus components replaced the AURA fork and a hybrid import path handles both AURA and BABE blocks. Related changes were made to the indexer (reading BABE block authors), the reserve contracts (optional BABE key in the federated ops datum), and upstream polkadot-sdk `stable2609`. The work comes with local-environment tooling, end-to-end tests, recorded migration demos, and an operator run book. The remaining hybrid-operation work has moved to phase 2. Delivered as midnight-node branch `demo-aura-to-babe-migration-q3` at `efb3735`.

Caveats: this is a demo feature branch built on the unreleased 3.0.0 runtime from `main`, which adds the generic session keys and the new session pallet. The migration has only been tested in a local environment. polkadot-sdk is pinned to a `stable2609` release candidate and will move to the final tag once it is published.

- **Run book:** [`sow-q3-05-babe-phase-1/examples/aura-to-babe-migration-runbook.md`](sow-q3-05-babe-phase-1/examples/aura-to-babe-migration-runbook.md), the AURA to BABE migration run book, copied from midnight-node at `efb3735`
- **Demo:** two narrated recordings in the [shared folder](https://drive.google.com/drive/folders/1ZeQPoU_CBcB3n-C7S-wDWE1cdzlhR9Et). Transcripts: [with Armed Babe](sow-q3-05-babe-phase-1/sow-05-with-ArmedBabe-b84629e572beb5908edefe01d96f0ec2c66dfacb.md), [without Armed Babe](sow-q3-05-babe-phase-1/sow-05-without-ArmedBabe-b4b4fcbb8306bf47dbd46007f83c86465c1503e1.md)

Acceptance criteria:

- AC-1: Working prototype of Babe integrated into a branch of the Q2 release

### SOW-Q3-06 Block production rewards

Block production rewards. The prototype computes block production rewards in NIGHT on Midnight and pays them on Cardano, end to end on a local devnet: a Cardano devnet with db-sync and six Midnight nodes, whose committee is five permissioned producers and one registered stake pool. On the node side, a new `pallet-block-rewards` credits each block producer with a fixed share plus a share that scales with block utilisation, and routes the remainder to the Treasury. At each epoch close it splits a pool's accrued NIGHT between the pool's reward account and its delegators, pro rata by stake in the Cardano snapshot that selected the committee, then publishes a Merkle root of the payable balances. On the Cardano side, the reserve contracts add a timed reserve release into a rewards pool, a virtual account per stake key, and a permissionless batcher that proves the root through the committee bridge and pays each account, with CLI commands to release, register, and batch. Two MIPs specify the full implementation. Block Production Rewards Payout on Cardano responds to MPS-0019 and defines the pallet, the Cardano contracts, and the payout flow. Committee Bridge Consensus Integration, which it requires, specifies the light client on Cardano that tracks Midnight's committee and the data pump and funding pool the rewards design reuses. Both are unnumbered and under review. Delivered as midnight-node branch `block-rewards-demo` at `d7c4404` and midnight-reserve-contracts branch `block-rewards-validators` at `bb2a358`.

Caveats: both branches are built on the unreleased node 3.0.0 from `main`. The prototype has only been run on a local devnet. Midnight epochs in the demo are one minute, so the pump loads and pays one epoch a minute; the MIPs assume six-hour epochs. Exits are not yet implemented, so the demo does not deregister.

- **Proposal:** [Block Production Rewards Payout on Cardano](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/321), open for review
- **Proposal:** [Committee Bridge Consensus Integration](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262), required by the rewards MIP, open for review
- **Problem statement:** [MPS-0019 block production rewards in NIGHT](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/5d881268081842bdd3b52bf6b4509c937de95c22/mps/mps-0019-block-production-rewards-night.md), status Proposed
- **Prototype:** [rewards overview](sow-q3-06-block-production-rewards/examples/rewards-overview.md), copied from midnight-reserve-contracts at `bb2a358`, and [`pallets/block-rewards`](https://github.com/midnightntwrk/midnight-node/tree/d7c4404eac1babfa079752383b016ae65da5df52/pallets/block-rewards)
- **Demo:** narrated recording in the [shared folder](https://drive.google.com/drive/folders/1oFfkFWj1NpId2b1vL5UPrWwrnGnD0QiG), recorded on the `block-rewards-demo` and `block-rewards-validators` branches with a custom Lace build. Transcript: [block production rewards](sow-q3-06-block-production-rewards/sow-06-block-production-rewards-98996518b3c95e9e0fecb169fa01c0cf90423993.md)
- **To exercise:** follow [Local demo](sow-q3-06-block-production-rewards/examples/rewards-overview.md#local-demo) in the rewards overview. It runs midnight-node `block-rewards-demo` at [`d7c4404`](https://github.com/midnightntwrk/midnight-node/commit/d7c4404eac1babfa079752383b016ae65da5df52) and the scripts under `demo/` at [`bb2a358`](https://github.com/midnightntwrk/midnight-reserve-contracts/commit/bb2a35869b5e9389ad5bcf5123faa7788c3dc170), with the [custom Lace build](https://github.com/MicroProofs/lace/tree/3fc3166590bfc61ce6c5faf5d1d680376163a833) for registering and withdrawing from the wallet

Acceptance criteria:

- AC-1: A working prototype and a MIP for the full implementation of block production rewards distributed as NIGHT to participating validators on the Midnight Network. Payment to Ada stakers is out of scope in this phase

### SOW-Q3-07 Shielded source of funds

Shielded source of funds. Time and materials; no acceptance criteria apply.

[MPS-0025](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/5d881268081842bdd3b52bf6b4509c937de95c22/mps/mps-0025-shielded-source-of-funds.md) asks how a regulated custodian obtains source-of-funds evidence for an incoming shielded asset without making shielded transfers traceable. The explorations led to conclusion, that any design supporting this needs a form of custom spend logic - token movements need to be guarded by additional logic to enable token issuers equip their tokens with checks and disclosures that let custodians manage the assets compliantly. Such logic cannot be part of the protocol itself. Such functionality enables different designs, where the main proposed one can be described as Midnight's analogue to T-REX tokens ([ERC-3643](https://eips.ethereum.org/EIPS/eip-3643)). 

- **Outputs:** a possible solution design to the source of funds problem via custom spend logic-enabled token guards: [Custom spend logic + enabled source of funds designs](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/335) (Commit [41d3b15](https://github.com/midnightntwrk/midnight-improvement-proposals/commit/41d3b15302b0a69cff62cafc19767c4c1be478fb))

### SOW-Q3-08 Hard fork v8 to v9

Hard fork: Ledger v8 to v9 migration. Every validator moves to node 2.1.0 first while the chain keeps running ledger 8. A Federated Authority motion, approved by both Council and Technical Committee, then replaces the on-chain runtime, and the next block runs a one-time ledger 8 to 9 state translation. NIGHT balances carry across, and contracts deployed before the fork keep their state and remain callable; pre-fork DApps built with compactc 0.31.1 work after the fork without recompiling. DUST is reset by design: every wallet must re-register its DUST address before paying fees, cNIGHT-backed DUST is replayed automatically, and ledger-8-format transactions are rejected after the fork.

- **Test evidence:** [`sow-q3-08-hard-fork-v8-v9/test-evidence/sow-q3-08-hard-fork-v8-v9-qa-test-evidence.md`](sow-q3-08-hard-fork-v8-v9/test-evidence/sow-q3-08-hard-fork-v8-v9-qa-test-evidence.md), PASS on local-env and devnet; qanet is the next environment
- **Walkthrough:** [`sow-q3-08-hard-fork-v8-v9/examples/hard-fork-migration-demo-walkthrough.md`](sow-q3-08-hard-fork-v8-v9/examples/hard-fork-migration-demo-walkthrough.md)
- **Demo:** [walkthrough recording](https://drive.google.com/file/d/1i5xozA49ousZ88ig2qAyCLs28LJYJ9fx/view) and [walkthrough deck](https://docs.google.com/presentation/d/12iV23ChouexlcPjLc3jBGQeWq_6qZLEvYWW728cfqHE). Transcript: [Ledger 8 to Ledger 9 hard fork](sow-q3-08-hard-fork-v8-v9/sow-08-hardfork-demo.md)

Acceptance criteria:

- AC-1: Ledger state migrates from v8 to v9 across designated test environments; associated SDKs, wallets and DApp interfaces function correctly without loss of state or breaking changes
- AC-2: Proven technical capability and operational readiness to support the Foundation in executing the v8 to v9 hard fork on mainnet

### SOW-Q3-09 Throughput performance

Throughput performance. Time and materials; no acceptance criteria apply. From July to September the team ran A/B experiments on a dedicated performance network and recorded twenty-eight entries: nine experiments and nineteen ideas. The largest measured win is a transaction revalidation cache: on blocks carrying transactions, block production was 42.4% faster and block import 41.1% faster. Releasing the interim ledger states the node keeps for every transaction cut ledger store growth by 42% over a 20-hour run. Per-transaction instrumentation put ledger `apply` at about 88% of per-transaction compute and zero-knowledge proof verification at about 11%. Adding CPUs had no effect because validators are single-thread bound, so further work points at parallelisation and the operational parameters rather than proof verification. The two largest wins are written up as proposals. Combined they were measured in a live network to sustain 12.7tps. 

- **Proposal:** [Transaction Revalidation Cache](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/312), open for review
- **Proposal:** [Interim Ledger State Management](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/309), open for review
- **Problem statement:** [consensus performance issues](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/82), open for review
- **Report:** [Throughput exploration, Q3 2026](sow-q3-09-throughput-performance/sow-09-throughput-exploration-45c00ed5401a96470745daf498e9833097f4abd1.pdf), 147 pages, dated 30 September 2026, SHA-256 `b53b19ee83817dcd603f7395ac26a4e38aaf055bad9bbd886b37cd91bd67da86`. Its source, the chapters and the experiment data behind each entry, is in the [shared folder](https://drive.google.com/drive/folders/1npFBW1x4bLR6HU-i6erhs4W4Nepe2hBD) as `sow-09-throughput-exploration-45c00ed5401a96470745daf498e9833097f4abd1/`
- **Load testing artifact** [Sep 10 Load test - 12.7tps](https://drive.google.com/file/d/1gjWX6LZsVwD5p-Nbv8rocTKWcXlIPOnS/view?usp=drive_link)
