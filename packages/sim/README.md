# @midnight-ntwrk/mnkit-sim

An in-memory harness for testing a compiled Compact contract: deploy it and
call its circuits with `@midnight-ntwrk/midnight-js-protocol`'s compact
runtime, with no network and no proofs. Part of
[mnkit](https://www.npmjs.com/package/mnkit), whose projects use it in
`src/test/*.sim.test.ts`.

```ts
import { Sim, assertNotInPublicState, expectRejects } from '@midnight-ntwrk/mnkit-sim';
import { Contract, ledger } from '../../contract/managed/calculator/contract/index.js';
import { createCalculatorPrivateState, witnesses } from '../../contract/witnesses.js';

const deploy = (w = witnesses) =>
  Sim.deploy({ contract: new Contract(w), ledger, privateState: createCalculatorPrivateState() });

expect(deploy().call('add', 2n, 3n).ledger.result).toBe(5n);

// A witness that lies about the division is caught by the circuit's assert.
const lying = deploy({ ...witnesses, divMod: ({ privateState }) => [privateState, [4n, 0n]] });
expectRejects(() => lying.call('divide', 17n, 5n), 'incorrect division');

assertNotInPublicState(lying.ledger(), { secret: mySecretBytes });
```

- `Sim.deploy` / `.call` / `.as(coinPublicKey)` / `.ledger()`: run the
  constructor and circuits, switch caller, read the public ledger.
- `expectRejects`: a circuit call fails, optionally with a message.
- `assertNotInPublicState`, `findInPublicState`, `collectPublicBytes`: check
  that a secret never reaches public state.

Apache-2.0. Source: [midnight-examples/packages/sim](https://github.com/midnightntwrk/midnight-examples/tree/main/packages/sim).
