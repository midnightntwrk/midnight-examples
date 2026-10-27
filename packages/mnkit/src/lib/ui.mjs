// This file is part of mn-examples.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Renders packages/mnkit/templates/ui, a browser UI for a project's compiled contract, in
// memory, in one of two modes (see scaffold.mjs): an example's ui/ in the
// monorepo (scripts/new-ui.mjs, `npm run new:ui`), or a standalone project's
// ui/ (`mnkit add ui`). Zero dependencies — Node built-ins only.
//
// Everything is derived from the compiled contract, never from memory:
//   contract/managed/<c>/compiler/contract-info.json  circuits, witnesses, ledger
//   contract/managed/<c>/contract/index.d.ts          constructor arity only
//   contract/witnesses.ts                             private-state factory (read even
//                                                     without witnesses)
//   contract/<c>.compact                              which token operations it calls
//
// Seed templates may wrap lines in `// @if <cond>` ... `// @endif` (or the JSX
// form `{/* @if <cond> */}` ... `{/* @endif */}`); the block is kept only when
// <cond> holds (see CONDITIONS). Template-owned files must not use them: their
// content has to be the same for every example. `@if monorepo` / `@if
// standalone` mode blocks (selectBlocks) are allowed anywhere.
//
// Files come in two kinds (see SEED_FILES):
//   template-owned  identical for every UI up to name substitution and mode.
//                   In the monorepo, --check fails when an example's copy
//                   diverges and --sync rewrites it; in a standalone project,
//                   `mnkit upgrade` re-renders it unless it was edited.
//   seed            generated once as a working starting point (typed circuit
//                   wrappers, a ledger readout, an in-memory circuit test), then
//                   owned by the author. Re-renders skip them (skipSeeds).

import fs from 'node:fs';
import path from 'node:path';
import {
  ONE_TIME_ADVICE,
  SECRET_ADVICE,
  argTypeLiteral,
  enumValuesOf,
  isOneTimeArg,
  isSecretArg,
  listCompiled,
  readConstructor,
  readContractInfo,
  scanWitnessesTs,
  typeLabel,
} from './contract-info.mjs';
import { MODES, fileHash, selectBlocks } from './scaffold.mjs';
import { assertNoLeftoverTokens, deriveNames, fail, renderTree, substituteNames } from './template.mjs';
import { PKG_ROOT } from './toolchain.mjs';

export const UI_TEMPLATE_DIR = path.join(PKG_ROOT, 'templates', 'ui');

/** The UI's create-time choices, in ui/: what a re-render needs. */
export const UI_CONFIG = 'new-ui.json';

/** Template paths (pre-rename) generated once and then owned by the author. */
export const SEED_FILES = new Set(
  [
    'README.md',
    'src/midnight/__name__-api.ts',
    'src/components/__name__-panel.tsx',
    'src/__tests__/__name__-circuits.test.ts',
  ].map((p) => p.split('/').join(path.sep)),
);

/**
 * Template files only one mode gets, and their output path in standalone
 * (npm drops a published .gitignore, so the template ships `gitignore`; the
 * monorepo's root .gitignore covers its UIs). VERIFIED.md describes every
 * example's UI, so neither mode gets it.
 */
const MODE_FILES = {
  monorepo: { skip: ['VERIFIED.md', 'gitignore'] },
  standalone: { skip: ['VERIFIED.md'], rename: { gitignore: '.gitignore' } },
};

export const UI_KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__camelName__',
  '__MANAGED__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__WITNESS_METHOD_DOC__',
  '__CIRCUIT_UNION__',
  '__PRIVATE_STATE_BLOCK__',
  '__PS_CONTRACT_IMPORT__',
  '__CTOR_ARGS_TYPE__',
  '__DEPLOY_PARAMS__',
  '__DEPLOY_ARGS__',
  '__JOIN_PARAMS__',
  '__INITIAL_PS__',
  '__JOIN_INITIAL_PS__',
  '__PRIVATE_STATE_STORAGE__',
  '__PRIVATE_STATE_STORAGE_DOC__',
  '__CIRCUIT_WRAPPERS__',
  '__PANEL_API_IMPORTS__',
  '__LEDGER_FIELDS__',
  '__CIRCUIT_LIST__',
  '__CIRCUITS_STEP__',
  '__BALANCES_STEP__',
  '__CIRCUIT_CALLS__',
  '__DEPLOYMENT_OPS__',
  '__TEST_BODY__',
  '__NETWORK_IDS__',
  '__NEW_UI__',
  '__PROJECT__',
];

// Networks every UI's picker offers, plus the ones a UI opts into through
// `"networks"` in its new-ui.json. Mainnet is opt-in per example: it spends
// real DUST, so only a UI that has been run there should offer it.
/**
 * Whether a planUi file is template-owned and hashed for `mnkit upgrade`:
 * not a seed, and not package.json, which upgrade merges (the author adds
 * dependencies to it).
 */
export const isUiOwned = (f) => !f.seed && f.rel !== 'package.json';

/** Tokens a template-owned file can use without reading the compiled contract. */
const CONTRACT_FREE_TOKENS = new Set(['__name__', '__Name__', '__Title__', '__camelName__', '__MANAGED__', '__NETWORK_IDS__', '__NEW_UI__', '__PROJECT__']);

/**
 * Whether a UI template file (raw) is rendered from the compiled contract: it
 * uses a token beyond the names, networks and paths. `mnkit upgrade` skips
 * these when the contract isn't compiled, and re-renders them when only the
 * contract changed.
 */
export const isContractDerived = (raw) => UI_KNOWN_TOKENS.some((t) => !CONTRACT_FREE_TOKENS.has(t) && raw.includes(t));

/** The generator's own source: a change to it changes what contract-derived files render to. */
let generatorHash = null;
/**
 * What a contract-derived file renders from besides the contract: its
 * template and the generator. mnkit.json records it under `sources`; while it
 * is unchanged, a different render means the contract changed.
 */
export function templateSource(raw) {
  generatorHash ??= fileHash(['ui.mjs', 'contract-info.mjs'].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\0'));
  return fileHash(`${generatorHash}\0${raw}`);
}

/** The render steps every UI file ends with: the name and path tokens, then the leftover check. */
function finishUiFile(out, rel, { camelName, managed, newUi, project, names }) {
  out = out.replaceAll('__camelName__', camelName).replaceAll('__MANAGED__', managed);
  out = out.replaceAll('__NEW_UI__', newUi).replaceAll('__PROJECT__', project);
  out = substituteNames(out, names);
  assertNoLeftoverTokens(rel, out, UI_KNOWN_TOKENS);
  return out;
}

export const BASE_NETWORKS = ['undeployed', 'preview', 'preprod'];
export const OPT_IN_NETWORKS = ['mainnet'];

/**
 * The UI's package.json in a standalone project: named <project>-ui. The
 * project's root package.json lists ui/ as an npm workspace.
 */
export function standaloneUiPackageJson(raw, name) {
  const p = JSON.parse(raw);
  p.name = `${name}-ui`;
  return `${JSON.stringify(p, null, 2)}\n`;
}

/**
 * Plans the UI for the project in `dir` (named `name`): reads the compiled
 * contract, then renders packages/mnkit/templates/ui. Returns what was read (for the
 * summary), `files` (`[{ templateRel, rel, content, seed }]`, rel relative to
 * ui/) and `configContent` (ui/new-ui.json).
 *
 *   contract      the contract/managed/<dir> to build the UI for; required
 *                 when the project compiles several
 *   privateState  'memory' | 'persistent'; default from the witnesses factory
 *   networks      opt-in networks (OPT_IN_NETWORKS) the network picker offers
 *   skipSeeds     leave the seed files out (re-renders)
 *   withoutContract  render only the template-owned files that don't read the
 *                 compiled contract (`contract` names it); `contractFiles`
 *                 lists the others (re-renders before a compile)
 *   where         how messages name the project ('examples/x', 'this project')
 *   compileHint   the command that compiles it, for the error without output
 */
export function planUi(
  dir,
  {
    name,
    mode = 'monorepo',
    contract: contractFlag = null,
    privateState: privateStateFlag = null,
    networks: extraNetworks = [],
    skipSeeds = false,
    withoutContract = false,
    where = mode === 'monorepo' ? `examples/${name}` : 'this project',
    compileHint = mode === 'monorepo' ? `npm run compile -w @midnight-ntwrk/example-${name}` : 'npm run compile',
    templateDir = UI_TEMPLATE_DIR,
  },
) {
  if (!MODES.includes(mode)) fail(`unknown mode '${mode}'`);
  if (privateStateFlag !== null && !['memory', 'persistent'].includes(privateStateFlag)) {
    fail(`--private-state must be memory or persistent, not '${privateStateFlag}'`);
  }
  if (
    !Array.isArray(extraNetworks) ||
    extraNetworks.some((n) => !OPT_IN_NETWORKS.includes(n)) ||
    new Set(extraNetworks).size !== extraNetworks.length
  ) {
    fail(`ui/${UI_CONFIG} "networks" must be a list of distinct ids from: ${OPT_IN_NETWORKS.join(', ')}`);
  }
  /** A project path as messages show it. */
  const at = (rel) => (mode === 'monorepo' ? `examples/${name}/${rel}` : rel);
  /** The project directory as generated files name it (`__name__` is filled in later). */
  const projectRef = mode === 'monorepo' ? 'examples/__name__/' : '';
  /** The generator command, and the project directory, as generated text names them. */
  const newUi = mode === 'standalone' ? 'mnkit add ui' : 'npm run new:ui';
  const project = mode === 'standalone' ? '..' : 'examples/__name__';
  const networkIds = [...BASE_NETWORKS, ...extraNetworks].map((n) => JSON.stringify(n)).join(', ');

  if (withoutContract) {
    if (!contractFlag) fail(`ui/${UI_CONFIG} names no contract.`);
    const names = deriveNames(name);
    const ctx = { camelName: names.Name[0].toLowerCase() + names.Name.slice(1), managed: contractFlag, newUi, project, names };
    const { skip, rename = {} } = MODE_FILES[mode];
    const contractFiles = [];
    const files = renderTree(templateDir, {
      name,
      skip: (rel) => {
        if (skip.includes(rel) || SEED_FILES.has(rel)) return true;
        if (rel === 'package.json' || !isContractDerived(fs.readFileSync(path.join(templateDir, rel), 'utf8'))) return false;
        contractFiles.push(rename[rel] ?? substituteNames(rel, names));
        return true;
      },
      render: (raw, rel) =>
        mode === 'standalone' && rel === 'package.json'
          ? standaloneUiPackageJson(raw, name)
          : finishUiFile(selectBlocks(raw, mode, rel).replaceAll('__NETWORK_IDS__', networkIds), rel, ctx),
    }).map((f) => ({ ...f, rel: rename[f.templateRel] ?? f.rel, seed: false }));
    return { files, contractFiles };
  }

  const compiled = listCompiled(dir);
  if (compiled.length === 0) {
    fail(
      `no compiled contract under ${at('contract/managed/')}. Compile it first (and get ` +
        `test:local green):  ${compileHint}`,
    );
  }
  let managed = contractFlag;
  if (managed === null) {
    if (compiled.length > 1) {
      fail(
        `${where} compiles ${compiled.length} contracts (${compiled.join(', ')}). ` +
          'Pick the primary one with --contract <dir>: the UI is generated for it, and the ' +
          'others are wired in the seed files (useMidnightProviders().providersFor; copy:zk ' +
          'serves every compiled contract).',
      );
    }
    managed = compiled[0];
  } else if (!compiled.includes(managed)) {
    fail(`--contract ${managed}: not found (compiled: ${compiled.join(', ')})`);
  }

  // --- read the compiled contract (packages/mnkit/src/lib/contract-info.mjs) -------------
  const info = readContractInfo(dir, managed);

  const circuits = info.circuits
    .filter((c) => c.proof)
    .map((c) => {
      const secrets = c.arguments.filter(isSecretArg);
      const oneTime = c.arguments.filter(isOneTimeArg);
      const unsupported = c.arguments.filter((a) => argTypeLiteral(a.type) === null);
      const reasons = [
        ...secrets.map((a) => `${a.name} looks like a secret: ${SECRET_ADVICE}`),
        ...oneTime.map((a) => `${a.name} looks like a one-time value: ${ONE_TIME_ADVICE}`),
        ...unsupported.map((a) => `${a.name} is a ${typeLabel(a.type)}`),
      ];
      return {
        name: c.name,
        args: c.arguments.map((a) => a.name),
        secretArgs: secrets.map((a) => a.name),
        oneTimeArgs: oneTime.map((a) => a.name),
        unsupportedArgs: unsupported.map((a) => `${a.name} (${typeLabel(a.type)})`),
        specs: reasons.length ? null : c.arguments.map((a) => ({ name: a.name, type: argTypeLiteral(a.type) })),
        todo: reasons.join('; '),
      };
    });
  const formCircuits = circuits.filter((c) => c.specs);
  const ledgerFields = info.ledger
    .filter((l) => l.exported)
    .map((l) => ({ name: l.name, storage: l.storage ?? 'Cell', enumValues: enumValuesOf(l.type) }));
  const hasLedger = ledgerFields.length > 0;
  const hasWitnesses = info.witnesses.length > 0;

  // contract-info.json doesn't list stdlib calls, so read the source: the
  // .compact whose basename is the managed dir, else every contract/*.compact.
  const contractDir = path.join(dir, 'contract');
  const compactSources = fs.readdirSync(contractDir).filter((f) => f.endsWith('.compact'));
  const ownSource = compactSources.find((f) => f === `${managed}.compact`);
  const compactSrc = (ownSource ? [ownSource] : compactSources)
    .map((f) => fs.readFileSync(path.join(contractDir, f), 'utf8'))
    .join('\n');
  /**
   * An unshieldedBalance* check fails in memory unless the test sets a balance.
   * Plain sends and receives don't check it, so they run in memory as they are.
   */
  const checksUnshieldedBalance = /\bunshieldedBalance\w*\s*\(/.test(compactSrc);
  /**
   * Token movements aren't ledger state. In memory they show up in the call's
   * Effects; on chain, in wallet balances.
   */
  const tokenOps = [
    ...new Set(
      compactSrc.match(/\b(mintUnshieldedToken|sendUnshielded|receiveUnshielded|mintShieldedToken|sendShielded|receiveShielded)(?=\s*\()/g) ?? [],
    ),
  ];

  // contract-info.json does not describe the constructor; index.d.ts does.
  const ctor = readConstructor(dir, managed);
  if (!ctor) {
    fail(`could not find initialState(...) in ${managed}/contract/index.d.ts — generator needs updating.`);
  }
  const hasCtorArgs = ctor.hasArgs;
  // Only for TODO comments: e.g. "_x1_0: bigint, _x2_0: bigint".
  const ctorParams = ctor.params;

  // The browser imports contract/witnesses.ts as is: it must be Node-free and
  // export a create<X>PrivateState factory (the phase-1 template convention).
  // It is read even when the contract declares no witnesses: a contract can
  // take its secrets as circuit arguments instead (private-party passes
  // `_secret` to every circuit), and the UI still has to keep them somewhere.
  let factory = null;
  let factoryTakesArgs = false;
  let factoryParams = '';
  let witnessesExport = null;
  const witnessesTs = scanWitnessesTs(dir, managed);
  if (hasWitnesses && !witnessesTs) {
    fail(`the contract declares witnesses but ${at('contract/witnesses.ts')} is missing.`);
  }
  if (hasWitnesses && !witnessesTs.factory) {
    fail(`${at('contract/witnesses.ts')} has no \`export const create<X>PrivateState = (...) =>\` factory.`);
  }
  if (witnessesTs?.factory) {
    if (witnessesTs.importsNode) {
      fail(`${at('contract/witnesses.ts')} imports node:* modules; the browser can't load it. Move those out first.`);
    }
    factory = witnessesTs.factory;
    factoryParams = witnessesTs.factoryParams;
    factoryTakesArgs = factoryParams !== '';
  }
  if (hasWitnesses) {
    // `witnesses`, or `<contract>Witnesses` when one file serves several
    // contracts (shielded-chips: rouletteWitnesses, chipsWitnesses).
    witnessesExport = witnessesTs.witnessesExport;
    if (!witnessesExport) {
      fail(`${at('contract/witnesses.ts')} exports neither \`witnesses\` nor \`${witnessesTs.perContract}\`.`);
    }
  }
  // Import specifier that binds the contract's witnesses to `witnesses`.
  const witnessesSpecifier = witnessesExport === 'witnesses' ? 'witnesses' : `${witnessesExport} as witnesses`;
  // Can the UI build the initial private state on its own?
  const psAuto = !factoryTakesArgs;
  // A factory with parameters builds per-user private state (secret keys,
  // hidden values): losing it on reload usually locks the user out.
  const privateState = privateStateFlag ?? (factoryTakesArgs ? 'persistent' : 'memory');
  const configContent = `${JSON.stringify(
    { contract: managed, privateState, ...(extraNetworks.length ? { networks: extraNetworks } : {}) },
    null,
    2,
  )}\n`;

  const names = deriveNames(name);
  const { Name } = names;
  const camelName = Name[0].toLowerCase() + Name.slice(1);

  // Wrapper names share a module with these identifiers.
  const taken = new Set([
    'deployContract', 'findDeployedContract', 'map', 'ledger', 'ledger$', 'PRIVATE_STATE_ID', 'CircuitArgs',
    'createInitialPrivateState', 'ConstructorArgs', `Compiled${Name}Contract`, `deploy${Name}`,
    `join${Name}`, `${Name}Contract`,
    // the panel imports the wrappers next to these
    'pureCircuits', 'PRIVATE_STATE_STORAGE',
    'CIRCUITS', 'CALLS', 'CircuitForm', 'LEDGER_FIELDS', 'formatLedgerValue', 'LedgerField', 'useMemo',
    'useContractState',
    'useDeployment', 'DeploymentCard', 'Card', 'CardContent', 'CardDescription', 'CardHeader',
    'CardTitle', 'ArgSpec', 'CircuitSpec', 'WalletBalancesCard',
  ]);
  for (const c of circuits) {
    if (taken.has(c.name)) fail(`circuit '${c.name}' collides with an identifier in the generated ${name}-api.ts or ${name}-panel.tsx.`);
  }

  // --- generated blocks ------------------------------------------------------

  /** The seed in-memory circuits test (src/__tests__/__name__-circuits.test.ts). */
  function testBody() {
    const constructs = !hasCtorArgs && psAuto;
    const wrappers = circuits.map((c) => c.name);
    const lines = [
      `import { describe, ${constructs ? 'expect, ' : ''}${wrappers.length ? 'expectTypeOf, ' : ''}it } from "vitest";`,
      ...(wrappers.length
        ? ['import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";']
        : []),
      ...(constructs
        ? [
            'import { createConstructorContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";',
            'import { Contract, createInitialPrivateState, ledger } from "../midnight/contract";',
          ]
        : wrappers.length
          ? ['import type { Contract } from "../midnight/contract";']
          : []),
      ...(wrappers.length ? [`import { ${wrappers.join(', ')} } from "../midnight/__name__-api";`] : []),
      ...(constructs && hasWitnesses
        ? [
            `import { ${witnessesSpecifier} } from "../../../contract/witnesses.js";`,
          ]
        : []),
      ...(checksUnshieldedBalance ? ['// import { withUnshieldedBalance } from "./contract-balance";'] : []),
      '',
      ...(constructs ? ['const COIN_PK = "00".repeat(32);', ''] : []),
      'describe("__name__ contract (in memory)", () => {',
      ...(constructs
        ? [
            '  it("constructs and decodes the initial ledger", () => {',
            `    const contract = new Contract(${hasWitnesses ? 'witnesses' : '{}'});`,
            '    const { currentContractState } = contract.initialState(',
            '      createConstructorContext(createInitialPrivateState(), COIN_PK),',
            '    );',
            ...(hasLedger
              ? ['    expect(ledger(currentContractState.data)).toBeDefined();']
              : ['    // The contract exports no ledger fields.', '    expect(ledger(currentContractState.data)).toEqual({});']),
            '  });',
          ]
        : [
            `  // TODO: constructing the contract needs ${needs}:`,
            ...(hasCtorArgs ? [`  //   constructor:   contract.initialState(context, ${ctorParams})`] : []),
            ...(!psAuto ? [`  //   private state: ${factory}(${factoryParams})`] : []),
            `  // Take the values from the Node test in ${projectRef}src/test/.`,
            '  it.todo("constructs and decodes the initial ledger");',
          ]),
      ...(circuits.length
        ? [
            '',
            `  // TODO: one test per circuit, asserting on ${hasLedger ? 'the ledger the UI will show' : 'what it returns and does'}:`,
            '  //   const ctx = createCircuitContext(dummyContractAddress(), COIN_PK,',
            '  //     currentContractState, createInitialPrivateState());',
            ...(checksUnshieldedBalance
              ? [
                  '  // The contract moves unshielded tokens, and an in-memory context starts',
                  "  // with an empty contract balance (receiveUnshielded doesn't credit the",
                  '  // next call). Give it what the chain would hold, or unshieldedBalance*',
                  '  // asserts always fail:',
                  '  //   withUnshieldedBalance(ctx, amount);',
                ]
              : []),
            '  //   const { result, context } = contract.impureCircuits.<circuit>(ctx, ...args);',
            ...(hasLedger ? ['  //   expect(ledger(context.currentQueryContext.state)).toEqual(...);'] : []),
            ...(tokenOps.length
              ? [
                  `  // Token movements (${tokenOps.join(', ')}) aren't ledger state. Assert`,
                  "  // on the call's effects instead, e.g.",
                  '  //   context.currentQueryContext.effects.unshieldedOutputs  // Map<TokenType, bigint>',
                  '  // (also unshieldedMints, unshieldedInputs, claimedUnshieldedSpends,',
                  '  // shieldedMints, claimedShieldedReceives, ...). TokenType keys are objects',
                  "  // ({ tag, raw }), so compare the Map's entries; get(key) won't match.",
                ]
              : []),
            ...circuits.map((c) => `  it.todo(${JSON.stringify(`${c.name}(${c.args.join(', ')})`)});`),
          ]
        : []),
      '});',
    ];
    if (wrappers.length) {
      lines.push(
        '',
        '// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at',
        '// runtime. Each wrapper must hit the callTx overload that proves, submits and',
        '// waits for finalization, and take exactly the circuit\'s arguments (counted',
        '// from contract-info.json) after the contract handle.',
        'describe("__name__ circuit wrappers (types)", () => {',
        '  it("submit through callTx with exactly the circuit\'s arguments", () => {',
        ...circuits.flatMap((c) => [
          `    expectTypeOf<Awaited<ReturnType<typeof ${c.name}>>>().toEqualTypeOf<`,
          `      FinalizedCallTxData<Contract, ${JSON.stringify(c.name)}>`,
          '    >();',
          `    expectTypeOf<Parameters<typeof ${c.name}>["length"]>().toEqualTypeOf<${c.args.length + 1}>();`,
        ]),
        '  });',
        '});',
      );
    }
    return lines.join('\n') + '\n';
  }

  const needs = [hasCtorArgs && 'constructor args', !psAuto && 'an initial private state']
    .filter(Boolean)
    .join(' and ');

  const blocks = {
    __NETWORK_IDS__: networkIds,
    __CIRCUIT_UNION__: circuits.length ? circuits.map((c) => JSON.stringify(c.name)).join(' | ') : 'never',
    __WITNESS_METHOD__: hasWitnesses ? 'withWitnesses(witnesses)' : 'withVacantWitnesses',
    __WITNESS_METHOD_DOC__: hasWitnesses
      ? 'withWitnesses: the TypeScript witnesses from contract/witnesses.ts.'
      : 'withVacantWitnesses: the contract declares no witnesses.',
    __PRIVATE_STATE_BLOCK__: factory
      ? [
          '/**',
          ` * Private state is whatever ${projectRef}contract/witnesses.ts builds.`,
          ...(hasWitnesses
            ? []
            : [
                ' * The contract declares no witnesses: the UI reads this state itself and',
                ' * passes what the circuits need as arguments, as the Node test does.',
              ]),
          ' * PRIVATE_STATE_STORAGE below says where it is kept (./private-state.ts).',
          ' */',
          `export type __Name__PrivateState = ReturnType<typeof ${factory}>;`,
          `export const createInitialPrivateState = ${factory};`,
        ].join('\n')
      : [
          '/**',
          ' * The contract declares no witnesses, so there is no private state.',
          ' * deployContract still wants a private-state id and an initial value, as',
          ' * in the Node test, so we store an empty object.',
          ' */',
          'export type __Name__PrivateState = Record<string, never>;',
          'export const createInitialPrivateState = (): __Name__PrivateState => ({});',
        ].join('\n'),
    __PS_CONTRACT_IMPORT__: psAuto ? 'createInitialPrivateState,\n  ' : 'type __Name__PrivateState,\n  ',
    __CTOR_ARGS_TYPE__: hasCtorArgs
      ? [
          '',
          "/** The contract constructor's arguments (everything after the context). */",
          'export type ConstructorArgs =',
          '  Parameters<Contract["initialState"]> extends [unknown, ...infer A] ? A : never;',
          '',
        ].join('\n')
      : '',
    __DEPLOY_PARAMS__:
      (psAuto ? '' : '\n  initialPrivateState: __Name__PrivateState,') +
      (hasCtorArgs ? '\n  args: ConstructorArgs,' : ''),
    __DEPLOY_ARGS__: hasCtorArgs ? '\n    args,' : '',
    // join only builds a fresh private state when none is stored, so it takes a
    // factory rather than a value (a fresh one may mean a fresh secret key).
    __JOIN_PARAMS__: psAuto ? '' : '\n  initialPrivateState: () => __Name__PrivateState,',
    __INITIAL_PS__: psAuto ? 'initialPrivateState: createInitialPrivateState()' : 'initialPrivateState',
    __JOIN_INITIAL_PS__: psAuto ? 'createInitialPrivateState()' : 'initialPrivateState()',
    __PRIVATE_STATE_STORAGE__: privateState,
    __PRIVATE_STATE_STORAGE_DOC__:
      privateState === 'persistent'
        ? 'encrypted in IndexedDB,\n * unlocked by a passphrase each session, so it survives reloads.'
        : 'in memory, so a reload\n * loses it.',
    __CIRCUIT_WRAPPERS__: circuits.length === 0 ? '' : [
      '',
      '/**',
      " * A circuit's arguments without its leading CircuitContext, i.e. what",
      ' * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx',
      ' * members are overloaded, and `Parameters` picks the last overload, whose',
      ' * first parameter is a TransactionContext.',
      ' */',
      'export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =',
      '  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;',
      '',
    ].join('\n') + circuits
      .map((c) =>
        [
          '',
          `/** Circuit \`${c.name}(${c.args.join(', ')})\`. */`,
          `export async function ${c.name}(`,
          '  contract: __Name__Contract,',
          `  ...args: CircuitArgs<${JSON.stringify(c.name)}>`,
          ') {',
          `  return contract.callTx.${c.name}(...args);`,
          '}',
          '',
        ].join('\n'),
      )
      .join(''),
    __PANEL_API_IMPORTS__: [
      !hasCtorArgs && psAuto && `deploy${Name}`,
      psAuto && `join${Name}`,
      hasLedger && 'ledger$',
      ...formCircuits.map((c) => c.name),
      formCircuits.length > 0 && 'type CircuitArgs',
      `type ${Name}Contract`,
    ]
      .filter(Boolean)
      .map((i) => `\n  ${i},`)
      .join('') + '\n',
    __LEDGER_FIELDS__: ledgerFields.length
      ? `[\n${ledgerFields
          .map(
            (l) =>
              `  { name: ${JSON.stringify(l.name)}, storage: ${JSON.stringify(l.storage)}` +
              (l.enumValues ? `, enumValues: [${l.enumValues.map((e) => JSON.stringify(e)).join(', ')}]` : '') +
              ' },',
          )
          .join('\n')}\n]`
      : '[]',
    __CIRCUIT_LIST__: circuits.length
      ? `[\n${circuits
          .map((c) =>
            c.specs?.length === 0
              ? `  { name: ${JSON.stringify(c.name)}, args: [] },`
              : c.specs
              ? [
                  `  {`,
                  `    name: ${JSON.stringify(c.name)},`,
                  `    args: [`,
                  ...c.specs.map((a) => `      { name: ${JSON.stringify(a.name)}, type: ${a.type} },`),
                  `    ],`,
                  `  },`,
                ].join('\n')
              : `  { name: ${JSON.stringify(c.name)}, args: null, todo: ${JSON.stringify(c.todo)} },`,
          )
          .join('\n')}\n]`
      : '[]',
    __CIRCUIT_CALLS__: formCircuits.length
      ? `{\n${formCircuits
          .map(
            (c) =>
              `  ${c.name}: async (contract, args) =>\n` +
              `    (await ${c.name}(contract, ...(args as CircuitArgs<${JSON.stringify(c.name)}>))).private.result,`,
          )
          .join('\n')}\n}`
      : '{}',
    __DEPLOYMENT_OPS__: [
      ...(!hasCtorArgs && psAuto
        ? ['    deploy: deploy__Name__,']
        : [
            `    // TODO: deploy__Name__ needs ${needs}`,
            '    // (see __name__-api.ts, and the Node test for values). Collect them in a form passed as',
            '    // <DeploymentCard deployForm={...}> that calls deployment.deploy(input), and',
            '    // type the hook as useDeployment<__Name__Contract, YourInput>({ ... }).',
            `    deploy: () => Promise.reject(new Error("TODO: supply ${needs} to deploy__Name__")),`,
          ]),
      ...(psAuto
        ? ['    join: join__Name__,']
        : [
            "    // TODO: join__Name__ needs a factory for this browser's initial private state",
            '    // (only called when none is stored yet), e.g. (p, a) => join__Name__(p, a, () => ...).',
            '    join: () => Promise.reject(new Error("TODO: supply the initial private state to join__Name__")),',
          ]),
    ].join('\n'),
    // Panel cards: 1. deployment, then ledger and wallet balances when present.
    __BALANCES_STEP__: String(hasLedger ? 3 : 2),
    __CIRCUITS_STEP__: String(2 + Number(hasLedger) + Number(tokenOps.length > 0)),
    __TEST_BODY__: testBody(),
  };

  /** `// @if <cond>` blocks in seed templates (see the header comment). */
  const CONDITIONS = { ledger: hasLedger, tokens: tokenOps.length > 0 };
  const IF_RE = /^\s*(?:\/\/|\{\/\*)\s*@if\s+(\w+)\s*(?:\*\/\})?\s*$/;
  const ENDIF_RE = /^\s*(?:\/\/|\{\/\*)\s*@endif\s*(?:\*\/\})?\s*$/;
  function applyConditions(raw, rel) {
    const keep = [];
    const out = [];
    for (const line of raw.split('\n')) {
      const open = IF_RE.exec(line);
      if (open) {
        if (!(open[1] in CONDITIONS)) fail(`unknown condition '@if ${open[1]}' in packages/mnkit/templates/ui/${rel}`);
        keep.push(CONDITIONS[open[1]]);
      } else if (ENDIF_RE.test(line)) {
        if (keep.pop() === undefined) fail(`'@endif' without '@if' in packages/mnkit/templates/ui/${rel}`);
      } else if (keep.every(Boolean)) {
        out.push(line);
      }
    }
    if (keep.length) fail(`unclosed '@if' in packages/mnkit/templates/ui/${rel}`);
    if (out.length !== raw.split('\n').length && !SEED_FILES.has(rel)) {
      fail(`packages/mnkit/templates/ui/${rel} is template-owned and must not use '@if' blocks`);
    }
    return out.join('\n');
  }

  function render(raw, rel) {
    if (mode === 'standalone' && rel === 'package.json') return standaloneUiPackageJson(raw, name);
    let out = applyConditions(selectBlocks(raw, mode, rel), rel);
    // Import line for witnesses: drop the whole line when there are none.
    const witnessImports = [factory, hasWitnesses && witnessesSpecifier].filter(Boolean);
    out = witnessImports.length
      ? out.replaceAll(
          '__WITNESS_IMPORT__',
          `import { ${witnessImports.join(', ')} } from "../../../contract/witnesses.js";`,
        )
      : out.replaceAll('__WITNESS_IMPORT__\n', '');
    // Blocks first (they contain name tokens), then names.
    for (const [token, value] of Object.entries(blocks)) out = out.replaceAll(token, value);
    return finishUiFile(out, rel, { camelName, managed, newUi, project, names });
  }

  const { skip, rename = {} } = MODE_FILES[mode];
  const files = renderTree(templateDir, {
    name,
    skip: (rel) => skip.includes(rel) || (skipSeeds && SEED_FILES.has(rel)),
    render,
  }).map((f) => {
    const seed = SEED_FILES.has(f.templateRel);
    const raw = seed ? '' : fs.readFileSync(path.join(templateDir, f.templateRel), 'utf8');
    // `source`: a contract-derived owned file's templateSource (mnkit upgrade).
    return { ...f, rel: rename[f.templateRel] ?? f.rel, seed, ...(isContractDerived(raw) ? { source: templateSource(raw) } : {}) };
  });

  return {
    managed,
    circuits,
    formCircuits,
    ledgerFields,
    hasWitnesses,
    hasLedger,
    factory,
    factoryParams,
    factoryTakesArgs,
    hasCtorArgs,
    ctorParams,
    privateState,
    privateStateDefaulted: privateStateFlag === null,
    needs,
    checksUnshieldedBalance,
    tokenOps,
    configContent,
    files,
  };
}

/** The create summary's details: what planUi read and chose. */
export function uiDetails(plan) {
  const { circuits, formCircuits, ledgerFields, hasWitnesses, factory, factoryParams, factoryTakesArgs } = plan;
  return (
    `  circuits: ${circuits.map((c) => c.name).join(', ') || '(none)'}` +
    `\n  generic forms: ${formCircuits.map((c) => c.name).join(', ') || '(none)'}` +
    `\n  ledger fields: ${ledgerFields.map((l) => l.name).join(', ') || '(none: no ledger card or ledger$)'}` +
    `\n  witnesses: ${hasWitnesses ? 'yes' : 'none'}` +
    `\n  private state: ${factory ? `${factory}(${factoryParams})${factoryTakesArgs ? ', needs args' : ''}` : 'none'}` +
    `\n  constructor args: ${plan.hasCtorArgs ? `yes (${plan.ctorParams})` : 'none'}` +
    `\n  private state storage: ${plan.privateState}${plan.privateStateDefaulted ? ' (default)' : ''}`
  );
}

/** The create summary's ⚠ lines: what the generated UI leaves to the author. */
export function uiWarnings(plan) {
  const { circuits, formCircuits, needs, checksUnshieldedBalance, tokenOps, hasLedger } = plan;
  const plural = (list, one, many) => `${list.join(', ')} ${list.length === 1 ? one : many}`;
  const lines = [];
  if (needs) {
    lines.push(`\n  ⚠ Deploy needs ${needs}: the panel has a TODO that rejects until you supply them.`);
  }
  /** Argument name → the circuits that take it, for one kind of argument. */
  const usesOf = (key) => {
    const uses = new Map();
    for (const c of circuits) for (const a of c[key]) uses.set(a, [...(uses.get(a) ?? []), c.name]);
    return uses;
  };
  for (const [arg, uses] of usesOf('secretArgs')) {
    lines.push(`  ⚠ ${arg} looks like a secret, so ${plural(uses, 'gets', 'get')} no form: ${SECRET_ADVICE}.`);
  }
  for (const [arg, uses] of usesOf('oneTimeArgs')) {
    lines.push(`  ⚠ ${arg} looks like a one-time value, so ${plural(uses, 'gets', 'get')} no form: ${ONE_TIME_ADVICE}.`);
  }
  for (const c of circuits.filter((c) => c.unsupportedArgs.length)) {
    lines.push(`  ⚠ ${c.name} gets no form: no generic input for ${c.unsupportedArgs.join(', ')}. Build one in the panel.`);
  }
  const coinTakers = formCircuits.filter((c) => c.specs.some((a) => a.type.includes('"shieldedCoin"'))).map((c) => c.name);
  if (coinTakers.length) {
    lines.push(
      `  ⚠ ${plural(coinTakers, 'takes', 'take')} a ShieldedCoinInfo. Its form picks one of the coins earlier ` +
        'calls returned in this session (lib/coin-book.ts); check the panel offers a circuit that returns one.',
    );
  }
  if (checksUnshieldedBalance) {
    lines.push(
      '  ⚠ The contract checks its unshielded balance. In-memory tests start with an empty contract ' +
        'balance: see withUnshieldedBalance in the circuits test.',
    );
  }
  if (tokenOps.length) {
    lines.push(
      `  ⚠ The contract moves tokens (${tokenOps.join(', ')}). ` +
        (hasLedger ? 'Those movements are not in the ledger readout. ' : '') +
        "In memory, assert on the call's effects (see the circuits test). The panel shows the wallet's balances " +
        '(<WalletBalancesCard>).',
    );
  }
  return lines;
}
