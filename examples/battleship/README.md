# Battleship Example

This repository demonstrates a simple version of the board game Battleship. The game board is represented as a single number line and ships are a single number placed on the number line. The first player to guess the 2 ship locations wins the game.

This example aims to demonstrate several key features of Compact and Midnight JS including:
- Compact contracts as state machines
- Explicit state management
- Verification of private state data
- Access control to circuits
- Operations on a `List`
- Intermediate witness functionality

For a guided walkthrough of the contract and its cheat-check tests, see the
[Battleship tutorial](./tutorials/index.mdx), also published at
[docs.midnight.network](https://docs.midnight.network/tutorials/battleship). It is step 4 of the
[learning path](../../README.md#learning-path).

## Set up

From the repo root, install dependencies (one lockfile for the whole workspace) and compile:
```bash
yarn install
yarn compile
```

Or compile just this example, from `examples/battleship`:
```bash
yarn compile
```

## Start the local Midnight network

Ensure the Docker engine is running, then from `examples/battleship`:
```bash
yarn env:up
yarn wait:dust     # wait until the dev wallets have spendable DUST for fees
```

## Run the test suite
```bash
yarn test:local
```

The test script will begin to display output from your local devnet and test suite. The tests will progress the contract deployment and interaction programatically:
```
[17:47:20.826] INFO (84251): Wallet sync complete after 21 emissions
[17:47:20.829] INFO (84251): Providers initialized on 'local', ready to test.
[17:47:39.294] INFO (84251): Contract deployed at: ccf2f4f27411dfa05ef7b9096b3fc07ea50c4ac0e942367dfefc9e821c9c3e74
[17:47:39.445] INFO (84251): Bob is accepting the game...
...
 ✓ src/test/battleship.test.ts (12 tests) 179167ms
     ✓ deploys the contract  18225ms
     ✓ Allows Bob to acceptGame  17155ms
     ✓ Allows Alice to take the first shot(MISS)  17340ms
     ✓ Allows Bob to check the board (MISS)  18665ms
     ✓ Allows Bob to shoot(HIT)  17348ms
     ✓ Allows Alice to check the board and report a hit  18670ms
     ✓ Allows Alice to shoot again (HIT)  17319ms
     ✓ Allows Bob to check the board for a HIT  17062ms
     ✓ Allows Bob to shoot the winning shot  18644ms
     ✓ Stops Alice from cheating  357ms
     ✓ Allows Alice to check the board and lose  16979ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

To run the zkir linter, from the project root run:
```bash
npx compact-zkir-lint -r contract/managed/battleship/zkir
```

The output should look like this:
```
zkir-lint: scanned 5 file(s)

  acceptGame (v2, k=12): clean
    instructions: 159  inputs: 2  constrain_bits: 4  cond_select: 6
    guarded regions: 0 (max depth 0)  proof payload: ~192KB

  checkBoard1 (v2, k=12): clean
    instructions: 400  inputs: 0  constrain_bits: 2  cond_select: 62
    guarded regions: 0 (max depth 1)  proof payload: ~192KB

  checkBoard2 (v2, k=12): clean
    instructions: 416  inputs: 0  constrain_bits: 2  cond_select: 61
    guarded regions: 0 (max depth 1)  proof payload: ~192KB

  player1Shoot (v2, k=11): clean
    instructions: 185  inputs: 1  constrain_bits: 3  cond_select: 4
    guarded regions: 0 (max depth 0)  proof payload: ~96KB

  player2Shoot (v2, k=11): clean
    instructions: 168  inputs: 1  constrain_bits: 3  cond_select: 4
    guarded regions: 0 (max depth 0)  proof payload: ~96KB

0 error(s), 0 warning(s), 0 info(s) | 5/5 clean
```

Tear the network down when finished:
```bash
yarn env:down
```

To run the suite against **preprod** or **preview** instead (`yarn test:preprod`,
`yarn test:preview`), see [FAST-SYNC.md](../../FAST-SYNC.md) at the repo root.
