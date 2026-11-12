# Hello World Example

The repository is intended as part of the tutorial flow for the hello-world example in the [Midnight documentation](https://docs.midnight.network/getting-started/hello-world). It does not operate as a complete repository without the accompanying documentation.

The below documentation will be provided here to "finish" this example.

## Set up project

From the repo root, install dependencies, then move into the example:

```bash
npm install
cd examples/hello-world
```

## Create the contract file

The contract lives in `contract/hello-world.compact`. To write it yourself, create the file:

```bash
touch contract/hello-world.compact
```

Open this file in VS Code:
```bash
code .
```

## Create the Compact Smart Contract

```compact
pragma language_version 0.28;

export ledger message: Opaque<"string">;

export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}
```
- `pragma language_version` specifies which version of Compact your contract uses.
- `ledger message` creates a state variable named `message` that stores a string value in the on-chain state. On-chain state is public and persistent on the blockchain.
- `circuit storeMessage` is a Compact circuit (function) that defines the logic to modify on-chain state.
- `newMessage: Opaque<"string">` is the input parameter. *Circuit parameters are always private by default.* The `disclose()` function marks the private value as safe to store publicly. Without it, trying to assign `newMessage` directly to the ledger returns a compiler error.

## Compile the contract

Compiling transforms your Compact code into zero-knowledge circuits, generates cryptographic keys, 
and creates TypeScript APIs and a JavaScript implementation for the contract to be used by DApps. 

Compile it with compiler 0.36.0 (this runs `compact compile contract/hello-world.compact contract/managed/hello-world`):

```bash
npm run compile
```

You should see the following output:

```
Compiling 1 circuits:
  circuit "storeMessage" (k=6, rows=36)
```

The compilation process will:
1. Parse and validate your Compact code.
2. Generate zero-knowledge circuits from your logic.
3. Create proving and verifying keys for the circuits.
4. Generate the TypeScript API and JavaScript implementation for the contract.

When compilation completes, you'll see a new directory structure:

```
contract/
├── managed/
|   └── hello-world/
|        ├── compiler/
|        ├── contract/
|        ├── keys/
|        └── zkir/
└── hello-world.compact
└── index.ts
```

Here's what each directory contains:

- **contract/**: The compiled contract artifacts, which includes the JavaScript implementation and type definitions.
- **keys/**: Cryptographic proving and verifying keys that enable zero-knowledge proofs.
- **zkir/**: Zero-Knowledge Intermediate Representation—the bridge between Compact and the ZK backend.
- **compiler/**: Compiler-generated JSON output that other tools can use to understand the contract structure.

## Deploy Contract to Local Devnet

Now that your contract is compiled, it needs to be deployed to the blockchain so that you can interact with it.

Be sure the Docker engine is running and in a *separate terminal* start the proof server from the project root:
```bash
npm run env:up
```

Leave the proof server running for the following steps.

To deploy the contract, you'll need a wallet. The local devnet package comes with 3 pre-funded wallets.


Run the deployment script:
```bash
npm run test:local
```

The test script will begin to show output from your local devnet and will progress the contract deployment and interaction programatically:

```
[12:46:12.694] INFO (22064): Wallet sync complete after 23 emissions
[12:46:12.703] INFO (22064): Providers initialized on 'local'. Ready to test!
[12:46:12.707] INFO (22064): Creating private state...
[12:46:32.347] INFO (22064): Setting the contract address...
[12:46:32.347] INFO (22064): Contract deployed at: bba6579743ae23b44301d4a9f8df30dbd5244d63a59d8fbc2c9fc7ea521a04f8
 ✓ src/test/hw.test.ts (2 tests) 39112ms
   ✓ Hello World Contract (local) > Deploys the contract  19649ms
   ✓ Hello World Contract (local) > Stores Hello World!   18184ms
```

Stop the Docker container:
```bash
npm run env:down
```

Hello World! You are now ready to explore [Tutorials](https://docs.midnight.network/category/tutorials) for more detailed instructions on building DApps on Midnight!

## Deploy Contract to Live Testnet

The wallet is built with `@midnight-ntwrk/testkit-js` and syncs from genesis. On Preprod the first sync takes **well over an hour** (one run took 88 minutes), almost all of it spent building the chain-wide DUST generation tree. The test waits up to 90 minutes between sync updates; set `MIDNIGHT_SYNC_TIMEOUT_MS` to change that.

To run the test script on Preview or Preprod:

1. Start the proof server: `npm run proof:up`
1. Start the test: `npm run test:preview` (small reference, quick) or `npm run test:preprod` (the headline network).

The suite drives the rest of the flow for you:

1. It **generates a fresh wallet** and syncs it. The wallet is saved under `.test-wallets/<network>.json` (gitignored) and reused on later runs.
1. Because a fresh wallet holds no funds, the suite **prints the wallet's address and the faucet URL, then pauses**. Fund it once with tNIGHT at the faucet — [Preview](https://midnight-tmnight-preview.nethermind.dev/) or [Preprod](https://midnight-tmnight-preprod.nethermind.dev/). The faucet is a human-facing web page (no programmatic drip endpoint). See [Environments and endpoints](https://docs.midnight.network/relnotes/network) for reference.
1. Once the tNIGHT arrives, the suite **resumes automatically**: it registers the NIGHT for DUST generation, waits for spendable tDUST to accrue, then runs the deploy and call tests. You do **not** need to delegate DUST manually.

> **Use the shared wallets instead.** If a repo-root `.env.<network>` exists (written by `npm run wallets:new` from the repo root), this suite uses Alice from it rather than generating its own throwaway wallet — the same wallet every other example runs as, so you fund one set once. The self-generating path above is the fallback for when that file is absent, which keeps hello-world usable as a zero-setup smoke test.
>
> **Bring your own wallet.** To use an existing wallet, copy the repo-root `.env.<network>.example` and set `MIDNIGHT_<NET>_ALICE_SEED` (or `_MNEMONIC`). Any `_BIRTHDAY` line is ignored: this suite always syncs from genesis.
## Frontend

[`ui/`](ui/) is a browser dApp for the same contract: connect a Midnight wallet, deploy or join, watch `message` update live, and call `storeMessage`, with proofs generated by the wallet or by your local proof server. With the contract compiled:

```bash
cd ui && npm run dev
```

See [`ui/README.md`](ui/README.md) for wallet setup, the proving toggle, and how each browser provider maps to the Node harness in `src/`.
