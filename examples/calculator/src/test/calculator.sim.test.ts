// In-memory tests for the calculator contract: the compiled circuits run with
// compact-runtime, with no network and no proofs. `yarn compile:fast` then
// `yarn test:sim` runs them in seconds; the devnet suite in calculator.test.ts
// covers the same circuits end to end.

import { describe, expect, it } from 'vitest';
import { Sim, expectRejects } from '@midnight-ntwrk/example-sim';
import { Contract, ledger } from '../../contract/managed/calculator/contract/index.js';
import { createCalculatorPrivateState, witnesses } from '../../contract/witnesses.js';

const deploy = () =>
  Sim.deploy({ contract: new Contract(witnesses), ledger, privateState: createCalculatorPrivateState() });

// Everything above is generated boilerplate. Your tests begin here.

describe('calculator (in memory)', () => {
  it('starts at zero', () => {
    expect(deploy().ledger().result).toBe(0n);
  });

  it('adds, subtracts, multiplies and squares', () => {
    const sim = deploy();
    expect(sim.call('add', 2n, 3n).ledger.result).toBe(5n);
    expect(sim.call('subtract', 10n, 4n).ledger.result).toBe(6n);
    expect(sim.call('multiply', 6n, 7n).ledger.result).toBe(42n);
    expect(sim.call('square', 12n).ledger.result).toBe(144n);
  });

  it('divides through the divMod witness', () => {
    expect(deploy().call('divide', 17n, 5n).ledger.result).toBe(3n);
  });

  it('rejects a witness that lies about the division', () => {
    const lying = new Contract({ ...witnesses, divMod: ({ privateState }) => [privateState, [4n, 0n]] });
    const sim = Sim.deploy({ contract: lying, ledger, privateState: createCalculatorPrivateState() });
    expectRejects(() => sim.call('divide', 17n, 5n), 'incorrect division');
    expect(sim.ledger().result).toBe(0n);
  });

  it('rejects results that overflow Uint<16>', () => {
    const sim = deploy();
    expectRejects(() => sim.call('multiply', 1000n, 1000n));
    expectRejects(() => sim.call('subtract', 1n, 2n));
  });
});
