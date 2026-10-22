# Engine test fixtures

Each fixture is a contract copied from an example, with what the tests need:

- `contract/*.compact` (and `witnesses.ts` when the example has one): the sources.
- `compiled/<contract>/`: the two compiler outputs the generators read,
  `contract-info.json` and `index.d.ts`. Regenerate them with
  `npm run fixtures:regen`; `npm run fixtures:regen -- --check` fails when the pinned
  compiler would emit something different.
- `overlay/` (end-to-end fixtures only): the completed files copied over a
  derived project, so `scripts/mnkit-e2e.sh` can run its tests. For
  `private-tip-jar` these are the example's own witnesses and tests, with the
  wallet imported from `@midnight-ntwrk/mnkit-wallet`, and a completed
  `contract/deploy-args.ts`: `mnkit deploy` deploys tip-token first and gives
  the jar that token's color.

| Fixture | Unit tests | End to end | Covers |
|---|---|---|---|
| `hello-world` | yes | yes | no constructor, no witnesses |
| `private-party` | yes | no | constructor arguments, including a secret |
| `silent-auction` | yes | no | a struct (`UserAddress`) constructor argument, witnesses |
| `private-tip-jar` | yes | yes | witnesses, a pure circuit, a `Map`, a shielded-coin argument, a second contract that mints |
