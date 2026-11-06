// @vitest-environment node
//
// Runs the real compiled __name__ contract in memory (no network, no proofs)
// to produce actual ledger states. Extend it with one call per circuit and
// assert on what the UI will display.
//
// Seed file: generated once by `__NEW_UI__`, then yours to edit. The drift
// check ignores it.
__TEST_BODY__