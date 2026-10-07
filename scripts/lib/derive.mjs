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

// `yarn new:example <name> --derive`: fills the generated-stub regions of a
// scaffolded example from its compiled contract (run `yarn compile:fast`
// first). A region looks like
//
//   // @generated-stub begin <id> sha=<hash of the body>
//   ...body...
//   // @generated-stub end <id>
//
// and is rewritten only while its body still matches the hash, i.e. until
// someone edits it. The template's regions say sha=0; new-example seals them
// (sealRegions) after substituting tokens, so every region starts unedited. Edited regions, and regions whose markers were deleted,
// are left alone, so code a person or model wrote is never touched. Running
// it twice gives the same files.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  compactConstructorParams,
  listCompiled,
  placeholderForCompactType,
  readConstructor,
  readContractInfo,
  scanWitnessesTs,
} from './contract-info.mjs';

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
  const lines = src.split('\n');
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
  return { out: out.join('\n'), status, missing };
}

/**
 * Sets every region's sha= to the hash of its current body. new-example runs
 * this on each rendered template file, so regions whose template text holds
 * a token (__INITIAL_PRIVATE_STATE__) start out unedited after substitution.
 */
export function sealRegions(src) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const begin = lines[i].match(BEGIN_RE);
    if (!begin) continue;
    const [, indent, id] = begin;
    const end = lines.findIndex((l, j) => j > i && l.match(END_RE)?.[1] === id);
    if (end === -1) throw new Error(`@generated-stub begin ${id} has no matching end marker`);
    lines[i] = `${indent}// @generated-stub begin ${id} sha=${stubHash(lines.slice(i + 1, end).join('\n'))}`;
    i = end;
  }
  return lines.join('\n');
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

const quote = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const signature = (c) => `${c.name}(${c.arguments.map((a) => `${a.name}: ${describe(a.type)}`).join(', ')})`;

/**
 * Derives the stubs of examples/<name> from its compiled contract. Throws on
 * anything that stops it; returns a report of what it did.
 */
export function derive(exampleDir, name, names) {
  const compiled = listCompiled(exampleDir);
  if (compiled.length === 0) {
    throw new Error(`no compiled contract under examples/${name}/contract/managed/. Run yarn compile:fast first.`);
  }
  // The primary contract: the one named after the example, else the only one.
  const managed = compiled.includes(name) ? name : compiled.length === 1 ? compiled[0] : null;
  if (!managed) {
    throw new Error(
      `examples/${name} compiles ${compiled.length} contracts (${compiled.join(', ')}) and none is named ${name}; ` +
        '--derive fills the stubs of the contract named after the example.',
    );
  }
  const info = readContractInfo(exampleDir, managed);
  const ctor = readConstructor(exampleDir, managed);
  if (!ctor) throw new Error(`could not find initialState(...) in ${managed}/contract/index.d.ts — derive needs updating.`);
  const witnessesTs = scanWitnessesTs(exampleDir, managed);
  if (info.witnesses.length > 0 && !witnessesTs) {
    throw new Error(
      `the contract declares witnesses (${info.witnesses.map((w) => w.name).join(', ')}) but contract/witnesses.ts ` +
        'is missing: the example was scaffolded without --witnesses. Re-scaffold with --witnesses, or copy ' +
        'templates/example/contract/witnesses.ts and wire withWitnesses() in contract/index.ts.',
    );
  }

  // Constructor parameters: names and types from the Compact source, checked
  // against the arity the compiler declared.
  const sourcePath = path.join(exampleDir, 'contract', `${managed}.compact`);
  const dtsParams = ctor.params ? ctor.params.split(',').map((p) => p.trim()) : [];
  let ctorParams = fs.existsSync(sourcePath) ? compactConstructorParams(fs.readFileSync(sourcePath, 'utf8')) : [];
  if (ctorParams.length !== dtsParams.length) {
    // Fall back to index.d.ts: names without the `_0` suffix, TS types only.
    ctorParams = dtsParams.map((p) => {
      const [n, t] = p.split(':').map((s) => s.trim());
      return { name: n.replace(/_\d+$/, ''), type: null, tsType: t };
    });
  }
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

  const ctorArgs = (indent) =>
    ctorParams.length === 0
      ? ''
      : [
          `${indent}args: [`,
          ...ctorParams.map((p) => `${indent}  ${placeholder(p)}, // TODO ${p.name}: ${p.type ?? p.tsType}`),
          `${indent}],`,
        ].join('\n');

  // The initial private state: the create<X>PrivateState factory, called with
  // a placeholder per parameter, so a factory that takes the owner's secret
  // (say) doesn't leave the deploy calls failing to type-check.
  const tsPlaceholder = (t) =>
    ({ bigint: '0n', boolean: 'false', string: "''", Uint8Array: 'new Uint8Array(32)' })[t.trim()] ?? 'undefined as never';
  const initialPrivateState = !witnessesTs?.factory
    ? '{}'
    : `${witnessesTs.factory}(${
        witnessesTs.factoryParams
          ? witnessesTs.factoryParams
              .split(',')
              .map((p) => {
                const [n, t = ''] = p.split(':');
                return `${tsPlaceholder(t)} /* TODO ${n.trim()} */`;
              })
              .join(', ')
          : ''
      })`;
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

  const devnetTodos = (indent) => impure.map((c) => `${indent}it.todo(${quote(signature(c))});`).join('\n');
  const simTodos = (indent) =>
    [
      ...impure.map((c) => `${indent}it.todo(${quote(signature(c))});`),
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

  const targets = [
    ['contract/witnesses.ts', { witnesses: witnessStubs }],
    [
      `src/test/${name}.test.ts`,
      {
        'private-state': privateStateLine('initialPrivateState'),
        'constructor-args': ctorArgs,
        'ledger-fields': ledgerComment,
        circuits: devnetTodos,
      },
    ],
    [
      `src/test/${name}.sim.test.ts`,
      {
        'private-state': privateStateLine('privateState'),
        'constructor-args': ctorArgs,
        circuits: simTodos,
        privacy: privacyTest,
      },
    ],
  ];

  const report = [];
  for (const [rel, generators] of targets) {
    const file = path.join(exampleDir, rel);
    if (!fs.existsSync(file)) {
      if (rel !== 'contract/witnesses.ts') report.push({ rel, note: 'file not found; skipped' });
      continue;
    }
    const src = fs.readFileSync(file, 'utf8');
    const { out, status, missing } = fillRegions(src, generators);
    if (out !== src) fs.writeFileSync(file, out);
    report.push({ rel, status, missing });
  }

  // An edited witnesses region can't gain stubs for witnesses added later.
  const wReport = report.find((r) => r.rel === 'contract/witnesses.ts');
  const unstubbed =
    wReport?.status?.witnesses === 'edited'
      ? info.witnesses.map((w) => w.name).filter((n) => !new RegExp(`\\b${n}\\s*[:(]`).test(witnessesTs.src))
      : [];

  return {
    managed,
    circuits: impure.map((c) => c.name),
    pureCircuits: pure.map((c) => c.name),
    witnesses: info.witnesses.map((w) => w.name),
    ctorParams: ctorParams.map((p) => p.name),
    report,
    unstubbed,
  };
}
