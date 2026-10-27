import { ChargedState, type CircuitContext, StateValue } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Sim } from './index.js';

// The smallest thing Sim.deploy accepts: an empty public state, and one
// circuit that returns the block time its context was built with.
const clockContract = {
  initialState: (context: { initialPrivateState: unknown }) => ({
    currentContractState: { data: new ChargedState(StateValue.newNull()) },
    currentPrivateState: context.initialPrivateState,
    currentZswapLocalState: undefined,
  }),
  impureCircuits: {
    now: (context: CircuitContext<unknown>) => ({
      result: context.currentQueryContext.block.secondsSinceEpoch,
      context,
      proofData: undefined,
      gasCost: undefined,
    }),
  },
};

describe('Sim.time', () => {
  // The fake contract isn't a compiled Contract, so the typed view is narrowed by hand.
  const deploy = () =>
    Sim.deploy({ contract: clockContract as never, privateState: {}, ledger: () => ({}) }) as unknown as {
      time: number | undefined;
      call(circuit: 'now'): { result: bigint };
    };

  it('sets the block time blockTimeLt / blockTimeGte see', () => {
    const sim = deploy();
    sim.time = 1_700_000_000;
    expect(sim.call('now').result).toBe(1_700_000_000n);
  });

  it('uses the real clock when unset', () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const now = deploy().call('now').result;
    expect(now >= before && now <= before + 5n).toBe(true);
  });
});
