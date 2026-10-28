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

// `mnkit derive` (`npm run new:example -- <name> --derive` in the monorepo): fills
// the generated-stub regions of a scaffolded project from its compiled
// contract (run the compile:fast script first). A region looks like
//
//   // @generated-stub begin <id> sha=<hash of the body>
//   ...body...
//   // @generated-stub end <id>
//
// and is rewritten only while its body still matches the hash, i.e. until
// someone edits it. The template's regions say sha=0; scaffolding seals them
// (sealRegions) after substituting tokens, so every region starts unedited.
// Edited regions, and regions whose markers were deleted, are left alone, so code a person or model wrote is never touched. Running
// it twice gives the same files. A CRLF file is read as LF (so sha= is the
// same on any checkout) and written back with CRLF.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  compactConstructorParams,
  contractSources,
  isShieldedCoinInfo,
  listCompiled,
  placeholderForCompactType,
  readConstructor,
  readContractInfo,
  scanWitnessesTs,
  tsParams,
} from './contract-info.mjs';
import { toLf, withEolOf } from './template.mjs';

const BEGIN_RE = /^(\s*)\/\/ @generated-stub begin ([\w-]+) sha=([0-9a-f]*)$/;
const END_RE = /^\s*\/\/ @generated-stub end ([\w-]+)$/;

/** The hash in a region's begin marker: the first 12 hex digits of sha256(body). */
export const stubHash = (body) => createHash('sha256').update(body).digest('hex').slice(0, 12);

/**
 * Rewrites every region whose id has a generator and whose body is
 * unedited. `generators[id](indent)` returns the new body (lines joined with
 * '\n', each already indented; '' for an empty region). Returns the new
 * source and, per region id, 'filled' | 'unchanged' | 'edited', plus the ids
 * that have a generator but no region in the file.
 */
export function fillRegions(src, generators) {
  const lines = toLf(src).split('\n');
  const out = [];
  const status = {};
  for (let i = 0; i < lines.length; i++) {
    const begin = lines[i].match(BEGIN_RE);
    if (!begin) {
      out.push(lines[i]);
      continue;
    }
    const [, indent, id, sha] = begin;
    const end = lines.findIndex((l, j) => j > i && l.match(END_RE)?.[1] === id);
    if (end === -1) throw new Error(`@generated-stub begin ${id} has no matching end marker`);
    const body = lines.slice(i + 1, end).join('\n');
    const gen = generators[id];
    if (!gen || sha !== stubHash(body)) {
      if (gen) status[id] = 'edited';
      out.push(...lines.slice(i, end + 1));
    } else {
      const next = gen(indent);
      status[id] = next === body ? 'unchanged' : 'filled';
      out.push(`${indent}// @generated-stub begin ${id} sha=${stubHash(next)}`);
      if (next !== '') out.push(...next.split('\n'));
      out.push(lines[end]);
    }
    i = end;
  }
  const missing = Object.keys(generators).filter((id) => !(id in status));
  return { out: withEolOf(out.join('\n'), src), status, missing };
}

/**
 * Sets every region's sha= to the hash of its current body. new-example runs
 * this on each rendered template file, so regions whose template text holds
 * a token (__INITIAL_PRIVATE_STATE__) start out unedited after substitution.
 */
export function sealRegions(src) {
  const lines = toLf(src).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const begin = lines[i].match(BEGIN_RE);
    if (!begin) continue;
    const [, indent, id] = begin;
    const end = lines.findIndex((l, j) => j > i && l.match(END_RE)?.[1] === id);
    if (end === -1) throw new Error(`@generated-stub begin ${id} has no matching end marker`);
    lines[i] = `${indent}// @generated-stub begin ${id} sha=${stubHash(lines.slice(i + 1, end).join('\n'))}`;
    i = end;
  }
  return withEolOf(lines.join('\n'), src);
}

/** A Compact type from contract-info.json, written the way the source would. */
function describe(t) {
  if (!t) return '?';
  switch (t['type-name']) {
    case 'Bytes':
      return `Bytes<${t.length}>`;
    case 'Uint':
      return `Uint<0..${t.maxval}>`;
    case 'Vector':
      return `Vector<${t.length}, ${describe(t.type)}>`;
    case 'Struct':
    case 'Enum':
      return t.name ?? t['type-name'];
    case 'Alias':
      return t.name ?? describe(t.type);
    case 'Opaque':
      return `Opaque<"${t.tsType ?? '?'}">`;
    default:
      return t['type-name'];
  }
}

/** A circuit argument that is a coin: ShieldedCoinInfo, or QualifiedShieldedCoinInfo (adds mt_index). */
const isCoinArg = (a) =>
  a.type?.['type-name'] === 'Struct' && (isShieldedCoinInfo(a.type) || a.type.name === 'QualifiedShieldedCoinInfo');
const isCoinKeyArg = (a) => a.type?.['type-name'] === 'Struct' && a.type.name === 'ZswapCoinPublicKey';

/** tip-token → { Name: 'TipToken', camel: 'tipToken' }: the names the tip jar's hand wiring used. */
const contractNames = (c) => {
  const Name = c
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return { Name, camel: Name[0].toLowerCase() + Name.slice(1) };
};

const quote = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const signature = (c) => `${c.name}(${c.arguments.map((a) => `${a.name}: ${describe(a.type)}`).join(', ')})`;

/**
 * Derives the stubs of the project in `exampleDir` (named `name`) from its
 * compiled contracts: the primary one (named after the project) fills the
 * witness, constructor, circuit and ledger regions; each other contract (a
 * test-only token) gets an export block in contract/index.ts and a provider
 * set and deploy test in the devnet test. Shielded-coin circuits pull in the
 * coin helpers, `coinsPackage`. Throws on anything that stops it; returns a
 * report of what it did.
 */
export function derive(exampleDir, name, names, { coinsPackage = '@midnightntwrk/mnkit-coins' } = {}) {
  const compiled = listCompiled(exampleDir);
  if (compiled.length === 0) {
    throw new Error('no compiled contract under contract/managed/. Run the compile:fast script first.');
  }
  // The primary contract: the one named after the project, else the only one.
  const managed = compiled.includes(name) ? name : compiled.length === 1 ? compiled[0] : null;
  if (!managed) {
    throw new Error(
      `${name} compiles ${compiled.length} contracts (${compiled.join(', ')}) and none is named ${name}; ` +
        'derive fills the stubs of the contract named after the project.',
    );
  }
  const info = readContractInfo(exampleDir, managed);
  const ctor = readConstructor(exampleDir, managed);
  if (!ctor) throw new Error(`could not find initialState(...) in ${managed}/contract/index.d.ts — derive needs updating.`);
  const witnessesTs = scanWitnessesTs(exampleDir, managed);
  if (info.witnesses.length > 0 && !witnessesTs) {
    throw new Error(
      `the contract declares witnesses (${info.witnesses.map((w) => w.name).join(', ')}) but contract/witnesses.ts ` +
        'is missing: the project was scaffolded without --witnesses. Re-scaffold with --witnesses, or copy ' +
        "the template's contract/witnesses.ts and wire withWitnesses() in contract/index.ts.",
    );
  }

  // Constructor parameters: names and types from the Compact source, checked
  // against the arity the compiler declared.
  const paramsOf = (m, c) => {
    const sourcePath = path.join(exampleDir, 'contract', `${m}.compact`);
    const dtsParams = tsParams(c.params);
    const fromSource = fs.existsSync(sourcePath) ? compactConstructorParams(fs.readFileSync(sourcePath, 'utf8')) : [];
    if (fromSource.length === dtsParams.length) return fromSource;
    // Fall back to index.d.ts: names without the `_0` suffix, TS types only.
    return dtsParams.map((p) => ({ name: p.name.replace(/_\d+$/, ''), type: null, tsType: p.tsType }));
  };
  const ctorParams = paramsOf(managed, ctor);
  const placeholder = (p) =>
    p.type
      ? placeholderForCompactType(p.type)
      : { bigint: '0n', boolean: 'false', string: "''", Uint8Array: 'new Uint8Array(32)' }[p.tsType] ?? 'undefined as never';

  const impure = info.circuits.filter((c) => !c.pure);
  const pure = info.circuits.filter((c) => c.pure);
  const ledgerFields = info.ledger.filter((l) => l.exported);
  const fieldLabel = (l) =>
    l.storage === 'Map'
      ? `${l.name}: Map<${describe(l.key)}, ${describe(l.value)}>`
      : `${l.name}: ${l.storage && l.storage !== 'Cell' ? `${l.storage}` : describe(l.type)}`;

  const argsFor = (params) => (indent) =>
    params.length === 0
      ? ''
      : [
          `${indent}args: [`,
          ...params.map((p) => `${indent}  ${placeholder(p)}, // TODO ${p.name}: ${p.type ?? p.tsType}`),
          `${indent}],`,
        ].join('\n');
  const ctorArgs = argsFor(ctorParams);
  // The same placeholders as array elements, for contract/deploy-args.ts.
  const elementsFor = (params) => (indent) =>
    params.map((p) => `${indent}${placeholder(p)}, // TODO ${p.name}: ${p.type ?? p.tsType}`).join('\n');

  // The other contracts this example compiles (a test-only token beside the
  // main one): every contract source except the primary. Each must have been
  // compiled, or derive would wire a contract that has no output to import.
  const secondaries = [];
  for (const { name: other } of contractSources(exampleDir)) {
    if (other === managed) continue;
    if (!compiled.includes(other)) {
      throw new Error(`contract/${other}.compact has not been compiled (no contract/managed/${other}). Run the compile:fast script first.`);
    }
    const otherInfo = readContractInfo(exampleDir, other);
    const otherCtor = readConstructor(exampleDir, other);
    if (!otherCtor) throw new Error(`could not find initialState(...) in ${other}/contract/index.d.ts — derive needs updating.`);
    // The example's witnesses.ts belongs to the primary contract: a second
    // contract with witnesses of its own is wired by hand.
    if (otherInfo.witnesses.length > 0) {
      secondaries.push({ name: other, status: 'has witnesses: wire it by hand' });
      continue;
    }
    secondaries.push({
      name: other,
      status: 'wired',
      ...contractNames(other),
      info: otherInfo,
      params: paramsOf(other, otherCtor),
      pure: otherInfo.circuits.some((c) => c.pure),
    });
  }
  const wired = secondaries.filter((s) => s.status === 'wired');

  // Shielded coins: a circuit that takes a coin, or another contract that
  // mints to a wallet, gets the coin helpers imported and hinted.
  const takesCoin = (c) => c.arguments.some(isCoinArg);
  const coinCircuits = info.circuits.filter((c) => !c.pure && takesCoin(c));
  const mintsToWallet = (s) => s.info.circuits.some((c) => !c.pure && c.arguments.some(isCoinKeyArg));
  const devnetCoins =
    coinCircuits.length > 0 || wired.some((s) => mintsToWallet(s) || s.info.circuits.some((c) => !c.pure && takesCoin(c)));

  // The initial private state: the create<X>PrivateState factory, called with
  // a placeholder per parameter, so a factory that takes the owner's secret
  // (say) doesn't leave the deploy calls failing to type-check.
  const tsPlaceholder = (t) =>
    ({ bigint: '0n', boolean: 'false', string: "''", Uint8Array: 'new Uint8Array(32)' })[t.trim()] ?? 'undefined as never';
  const initialPrivateState = !witnessesTs?.factory
    ? '{}'
    : `${witnessesTs.factory}(${tsParams(witnessesTs.factoryParams)
        .map((p) => `${tsPlaceholder(p.tsType)} /* TODO ${p.name} */`)
        .join(', ')})`;
  const privateStateLine = (key) => (indent) => `${indent}${key}: ${initialPrivateState},`;

  const psType = witnessesTs?.privateStateType ?? `${names.Name}PrivateState`;
  const witnessesConst = witnessesTs?.witnessesExport ?? 'witnesses';
  const witnessStubs = () =>
    [
      `export const ${witnessesConst}: Witnesses<${psType}> = {`,
      ...info.witnesses.flatMap((w) => [
        `  ${w.name}: ({ privateState }${w.arguments.map((a) => `, ${a.name}`).join('')}) => {`,
        `    // TODO: return [nextPrivateState, value], value a ${describe(w['result type'])}` +
          (w.arguments.length ? ` (args: ${w.arguments.map((a) => `${a.name}: ${describe(a.type)}`).join(', ')})` : ''),
        `    throw new Error(${quote(`witness ${w.name} is not implemented`)});`,
        '  },',
      ]),
      '};',
    ].join('\n');

  // A coin argument gets a hint naming the helper that makes one. `how` maps
  // the argument to it. On the devnet a ShieldedCoinInfo is a new coin the
  // transaction creates (the wallet pays for it), so it comes from freshCoin,
  // never from the wallet's own coins; a QualifiedShieldedCoinInfo is a coin
  // the contract already holds.
  const coinHint = (c, how) => {
    const coins = c.arguments.filter(isCoinArg);
    return coins.length ? ` — ${coins.map((a) => `${a.name}: ${how(a)}`).join(', ')}` : '';
  };
  const devnetCoinHow = (a) =>
    isShieldedCoinInfo(a.type) ? 'freshCoin(color, value)' : "a coin the contract holds, from its ledger (insertCoin)";
  const devnetTodos = (indent) =>
    impure.map((c) => `${indent}it.todo(${quote(signature(c) + coinHint(c, devnetCoinHow))});`).join('\n');
  const simTodos = (indent) =>
    [
      ...impure.map((c) => `${indent}it.todo(${quote(signature(c) + coinHint(c, () => 'simCoin(value, color)'))});`),
      ...pure.map((c) => `${indent}it.todo(${quote(`${signature(c)} (pure)`)});`),
    ].join('\n');
  const ledgerComment = (indent) =>
    ledgerFields.length === 0
      ? `${indent}// Public ledger fields: none.`
      : [`${indent}// Public ledger fields:`, ...ledgerFields.map((l) => `${indent}//   ${fieldLabel(l)}`)].join('\n');
  const privacyTest = (indent) =>
    [
      `${indent}// SPEC.md → Privacy invariants: one entry per "never on chain" line.`,
      `${indent}it('keeps secrets out of public state', () => {`,
      `${indent}  const l = deploy().ledger();`,
      `${indent}  expect(Object.keys(l).sort()).toEqual([${ledgerFields.map((l) => quote(l.name)).sort().join(', ')}]);`,
      `${indent}  assertNotInPublicState(l, {`,
      `${indent}    // TODO: secretName: bytes,`,
      `${indent}  });`,
      `${indent}});`,
    ].join('\n');

  // --- the other contracts: exports, providers, a deploy test each ---------
  const secondaryExports = () =>
    wired
      .map((s) =>
        [
          `// contract/${s.name}.compact, compiled to contract/managed/${s.name}. It declares no witnesses.`,
          'export {',
          `  Contract as ${s.Name}Contract,`,
          `  ledger as ${s.camel}Ledger,`,
          ...(s.pure ? [`  pureCircuits as ${s.camel}PureCircuits,`] : []),
          `  type Ledger as ${s.Name}Ledger,`,
          `} from './managed/${s.name}/contract/index.js';`,
          `import { Contract as ${s.Name}ContractClass } from './managed/${s.name}/contract/index.js';`,
          `export const ${s.camel}ZkConfigPath = path.resolve(currentDir, 'managed', ${quote(s.name)});`,
          '',
          `export const Compiled${s.Name}Contract = CompiledContract.make(`,
          `  ${quote(`${s.Name}Contract`)},`,
          `  ${s.Name}ContractClass,`,
          ').pipe(',
          '  CompiledContract.withVacantWitnesses,',
          `  CompiledContract.withCompiledFileAssets(${s.camel}ZkConfigPath),`,
          ');',
        ].join('\n'),
      )
      .join('\n\n');
  const contractImports = (indent) =>
    wired
      .flatMap((s) => [`Compiled${s.Name}Contract`, `type ${s.Name}Contract`, `${s.camel}Ledger`, `${s.camel}ZkConfigPath`])
      .map((x) => `${indent}${x},`)
      .join('\n');
  const contractProviders = (indent) =>
    wired.map((s) => `${indent}let ${s.camel}Providers: ${names.Name}Providers; // for contract/${s.name}.compact`).join('\n');
  const contractProvidersInit = (indent) =>
    wired.map((s) => `${indent}${s.camel}Providers = buildProviders(wallet, ${s.camel}ZkConfigPath, config);`).join('\n');
  const contractDeploys = (indent) =>
    wired
      .map((s) => {
        const circuits = s.info.circuits.filter((c) => !c.pure);
        const mints = mintsToWallet(s);
        return [
          `${indent}// contract/${s.name}.compact. Its circuits, called with submitCallTx and ${s.camel}Providers:`,
          ...circuits.map((c) => `${indent}//   ${signature(c)}`),
          ...(mints
            ? [
                `${indent}// A circuit that makes coins for a wallet takes recipientOf(wallet) as the`,
                `${indent}// ZswapCoinPublicKey and, for a wallet other than the caller's, needs`,
                `${indent}// additionalCoinEncPublicKeyMappings: encryptionKeys(otherWallet). A fresh mintNonce()`,
                `${indent}// per mint; the coins' color is tokenColor(<its domain separator>, ${s.camel}Address).`,
              ]
            : []),
          `${indent}let ${s.camel}Address: ContractAddress;`,
          `${indent}it(${quote(`deploys ${s.name}`)}, async () => {`,
          `${indent}  const deployed: DeployedContract<${s.Name}Contract> = await (deployContract<${s.Name}Contract>)(${s.camel}Providers, {`,
          `${indent}    compiledContract: Compiled${s.Name}Contract,`,
          ...(s.params.length ? [argsFor(s.params)(`${indent}    `)] : []),
          `${indent}  });`,
          `${indent}  ${s.camel}Address = deployed.deployTxData.public.contractAddress;`,
          `${indent}  logger.info(\`${s.name} deployed at: \${${s.camel}Address}\`);`,
          `${indent}  expect(${s.camel}Address).toBeDefined();`,
          `${indent}});`,
        ].join('\n');
      })
      .join('\n\n');
  // contract/deploy-args.ts: one `deployables` entry per other contract.
  const deployImports = (indent) =>
    wired.flatMap((s) => [`Compiled${s.Name}Contract`, `type ${s.Name}Contract`, `${s.camel}ZkConfigPath`]).map((x) => `${indent}${x},`).join('\n');
  const secondaryDeploys = (indent) =>
    wired
      .map((s) =>
        [
          `${indent}// contract/${s.name}.compact: \`mnkit deploy ${s.name}\`, before a contract whose constructor needs it.`,
          `${indent}${quote(s.name)}: deployable<${s.Name}Contract>({`,
          `${indent}  compiledContract: Compiled${s.Name}Contract,`,
          `${indent}  zkConfigPath: ${s.camel}ZkConfigPath,`,
          ...(s.params.length
            ? [`${indent}  args: (ctx: DeployContext) => [`, elementsFor(s.params)(`${indent}    `), `${indent}  ],`]
            : []),
          `${indent}}),`,
        ].join('\n'),
      )
      .join('\n');
  const COIN_HELPERS = [
    'encryptionKeys',
    'freshCoin',
    'mintNonce',
    'recipientOf',
    'shieldedBalance',
    'tokenColor',
    'waitForShieldedBalance',
  ];
  const devnetCoinImports = (indent) =>
    devnetCoins ? `${indent}import { ${COIN_HELPERS.join(', ')} } from ${quote(coinsPackage)};` : '';
  const simCoinImports = (indent) =>
    coinCircuits.length > 0 ? `${indent}import { simCoin } from ${quote(coinsPackage)};` : '';

  const targets = [
    ['contract/witnesses.ts', { witnesses: witnessStubs }],
    ['contract/index.ts', { 'secondary-contracts': secondaryExports }],
    [
      `src/test/${name}.test.ts`,
      {
        'private-state': privateStateLine('initialPrivateState'),
        'constructor-args': ctorArgs,
        'ledger-fields': ledgerComment,
        circuits: devnetTodos,
        'contract-imports': contractImports,
        'coin-imports': devnetCoinImports,
        'contract-providers': contractProviders,
        'contract-providers-init': contractProvidersInit,
        'contract-deploys': contractDeploys,
      },
    ],
    [
      'contract/deploy-args.ts',
      {
        'deploy-imports': deployImports,
        'private-state': privateStateLine('initialPrivateState'),
        'constructor-args': elementsFor(ctorParams),
        'secondary-deploys': secondaryDeploys,
      },
    ],
    [
      `src/test/${name}.sim.test.ts`,
      {
        'private-state': privateStateLine('privateState'),
        'constructor-args': ctorArgs,
        circuits: simTodos,
        privacy: privacyTest,
        'coin-imports': simCoinImports,
      },
    ],
  ];

  // Every file is filled before any is written: a broken marker in one
  // (fillRegions throws) leaves them all as they were.
  const report = [];
  const writes = [];
  for (const [rel, generators] of targets) {
    const file = path.join(exampleDir, rel);
    if (!fs.existsSync(file)) {
      if (rel === 'contract/deploy-args.ts') report.push({ rel, note: 'file not found; skipped (deploy needs it: `mnkit upgrade` adds it)' });
      else if (rel !== 'contract/witnesses.ts' && rel !== 'contract/index.ts') report.push({ rel, note: 'file not found; skipped' });
      continue;
    }
    const src = fs.readFileSync(file, 'utf8');
    let filled;
    try {
      filled = fillRegions(src, generators);
    } catch (err) {
      throw new Error(`${rel}: ${err.message}; nothing was written`);
    }
    const { out, status, missing } = filled;
    if (out !== src) writes.push([file, out]);
    // A region an older example never had is only worth reporting when it
    // would have held something (an example from before Phase 4 with one
    // contract and no coins has nothing to miss).
    report.push({ rel, status, missing: missing.filter((id) => generators[id]('') !== '') });
  }
  for (const [file, out] of writes) fs.writeFileSync(file, out);

  // An edited witnesses region can't gain stubs for witnesses added later.
  // A witness counts as written when its name is followed by `:` or `(`. The
  // names are collected with a fixed pattern rather than spliced into a RegExp.
  const wReport = report.find((r) => r.rel === 'contract/witnesses.ts');
  const written = new Set([...(witnessesTs?.src ?? '').matchAll(/\b([A-Za-z_$][\w$]*)\s*[:(]/g)].map((m) => m[1]));
  const unstubbed =
    wReport?.status?.witnesses === 'edited' ? info.witnesses.map((w) => w.name).filter((n) => !written.has(n)) : [];

  return {
    managed,
    circuits: impure.map((c) => c.name),
    pureCircuits: pure.map((c) => c.name),
    witnesses: info.witnesses.map((w) => w.name),
    ctorParams: ctorParams.map((p) => p.name),
    secondaries: secondaries.map((s) => ({ name: s.name, status: s.status })),
    report,
    unstubbed,
  };
}
