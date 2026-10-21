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

// Reads what a compiled contract declares, for the scripts that generate code
// from it (new-ui.mjs, derive.mjs). Everything comes from the compiler's
// output, never from memory:
//   contract/managed/<c>/compiler/contract-info.json  circuits, witnesses, ledger
//   contract/managed/<c>/contract/index.d.ts          constructor arity
//   contract/<c>.compact                              constructor parameter types
//   contract/witnesses.ts                             private-state factory, exports
// Functions here return data or null; callers decide how to fail.

import fs from 'node:fs';
import path from 'node:path';

/** Managed dirs under examples/<name>/contract/managed that hold a compiled contract, sorted. */
export function listCompiled(exampleDir) {
  const managedRoot = path.join(exampleDir, 'contract', 'managed');
  return fs.existsSync(managedRoot)
    ? fs
        .readdirSync(managedRoot)
        .filter((d) => fs.existsSync(path.join(managedRoot, d, 'compiler', 'contract-info.json')))
        .sort()
    : [];
}

/**
 * The contracts an example compiles: every contract/*.compact except files
 * that are only building blocks of another. A file is a building block when
 * it is one top-level `module X { … }` (zk-loan's schnorr.compact), or when
 * another .compact pulls it in with `import "x"` or `include "x"`. Each
 * contract compiles to contract/managed/<name>. Sorted by name.
 */
export function contractSources(exampleDir) {
  const dir = path.join(exampleDir, 'contract');
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.compact'))
    .sort()
    .map((f) => ({ name: f.slice(0, -'.compact'.length), file: path.join(dir, f) }));
  const srcs = new Map(files.map((f) => [f.name, stripComments(fs.readFileSync(f.file, 'utf8'))]));
  const pulledIn = new Set(
    [...srcs.values()].flatMap((s) =>
      [...s.matchAll(/\b(?:import|include)\s+"([^"]+)"/g)].map((m) => path.basename(m[1]).replace(/\.compact$/, '')),
    ),
  );
  return files.filter((f) => !pulledIn.has(f.name) && !isWholeModule(srcs.get(f.name)));
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** True when `src` (comments stripped) is a single `module X { … }` and nothing else. */
function isWholeModule(src) {
  const s = src.trim();
  const open = s.match(/^module\s+[\w$]+\s*\{/);
  if (!open) return false;
  let depth = 0;
  for (let i = open[0].length - 1; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/** contract-info.json of contract/managed/<managed>. */
export function readContractInfo(exampleDir, managed) {
  // `maxval` can exceed 2^53 (Uint<64>, Uint<128>, ...). Keep its exact source
  // text instead of letting JSON.parse round it to a float.
  return JSON.parse(
    fs.readFileSync(path.join(exampleDir, 'contract', 'managed', managed, 'compiler', 'contract-info.json'), 'utf8'),
    (key, value, ctx) => (key === 'maxval' ? ctx.source : value),
  );
}

/**
 * contract-info.json argument type → an ArgType literal for
 * src/lib/circuit-args.ts, or null when it has no generic form. The TypeScript
 * counterparts (bigint, boolean, string, Uint8Array, numeric enum) are the ones
 * the compiler emits in contract/index.d.ts; see the table in circuit-args.ts.
 */
export function argTypeLiteral(t) {
  switch (t['type-name']) {
    case 'Uint':
      return `{ kind: "uint", max: ${t.maxval}n }`;
    case 'Field':
      return '{ kind: "field" }';
    case 'Boolean':
      return '{ kind: "boolean" }';
    case 'Opaque':
      return t.tsType === 'string' ? '{ kind: "string" }' : null;
    case 'Bytes':
      return `{ kind: "bytes", length: ${t.length} }`;
    case 'Enum':
      return `{ kind: "enum", values: [${t.elements.map((e) => JSON.stringify(e)).join(', ')}] }`;
    case 'Alias':
      return argTypeLiteral(t.type);
    case 'Struct':
      // Three stdlib structs have a generic input. UserAddress and
      // ZswapCoinPublicKey are { bytes: Uint8Array } in TypeScript, and the
      // form can fill them from the wallet (lib/addresses.ts). A
      // ShieldedCoinInfo is picked from coins earlier results returned
      // (lib/coin-book.ts). Other structs: no form.
      if (isBytesStruct(t, 'UserAddress')) return '{ kind: "userAddress" }';
      if (isBytesStruct(t, 'ZswapCoinPublicKey')) return '{ kind: "coinPublicKey" }';
      if (isShieldedCoinInfo(t)) return '{ kind: "shieldedCoin" }';
      return null;
    default:
      return null;
  }
}

/** A stdlib struct `name { bytes: Bytes<32> }`, matched by shape as well as name. */
export function isBytesStruct(t, name) {
  const [e, ...rest] = t.elements ?? [];
  return t.name === name && rest.length === 0 && e?.name === 'bytes' && isBytes32(e.type);
}
export const isBytes32 = (t) => t?.['type-name'] === 'Bytes' && t.length === 32;
/** The stdlib ShieldedCoinInfo { nonce: Bytes<32>, color: Bytes<32>, value: Uint<128> }. */
export function isShieldedCoinInfo(t) {
  const el = Object.fromEntries((t.elements ?? []).map((e) => [e.name, e.type]));
  return (
    t.name === 'ShieldedCoinInfo' &&
    t.elements.length === 3 &&
    isBytes32(el.nonce) &&
    isBytes32(el.color) &&
    el.value?.['type-name'] === 'Uint'
  );
}

/**
 * A Bytes argument named like a secret (private-party's `_secret`, an `sk`) or
 * a one-time value (a mint `nonce`, a `salt`). A generic form would ask the
 * user to paste or invent it. The UI should generate it instead: a secret once,
 * kept in private state as the Node test does; a one-time value fresh for
 * every call (reusing a mint nonce mints the same coin again). Such circuits
 * get a TODO, not a form.
 */
export const SECRET_NAME_RE = /secret|^_?sk$|priv|seed/i;
export const ONE_TIME_NAME_RE = /nonce|salt/i;
export const isBytes = (a) => a.type['type-name'] === 'Bytes';
export const isSecretArg = (a) => SECRET_NAME_RE.test(a.name) && isBytes(a);
export const isOneTimeArg = (a) => !isSecretArg(a) && ONE_TIME_NAME_RE.test(a.name) && isBytes(a);
export const SECRET_ADVICE = 'generate it once in code and keep it in private state';
export const ONE_TIME_ADVICE = 'generate fresh random bytes in code for every call';
export const typeLabel = (t) => [t['type-name'], t.name, t.tsType].filter(Boolean).join(' ');
/** Enum member names of a ledger cell or Set/List element type, through aliases. */
export const enumValuesOf = (t) => (!t ? null : t['type-name'] === 'Alias' ? enumValuesOf(t.type) : t['type-name'] === 'Enum' ? t.elements : null);

/**
 * The constructor, from contract/index.d.ts (contract-info.json does not
 * describe it). Returns null if the declaration isn't where the generators
 * expect it. `params` is the raw parameter list, with the compiler's `_0`
 * suffixes, e.g. "acceptedColor_0: Uint8Array".
 */
export function readConstructor(exampleDir, managed) {
  const dts = fs.readFileSync(path.join(exampleDir, 'contract', 'managed', managed, 'contract', 'index.d.ts'), 'utf8');
  if (!dts.includes('initialState(context: __compactRuntime.ConstructorContext<PS>')) return null;
  // A constructor without parameters is exactly this line.
  const hasArgs = !dts.includes(
    'initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;',
  );
  const params = hasArgs
    ? (dts.match(/initialState\(context: __compactRuntime\.ConstructorContext<PS>,\s*([^)]*)\)/)?.[1] ?? '...')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return { hasArgs, params };
}

/**
 * contract/witnesses.ts as the generators need it: the create<X>PrivateState
 * factory and its parameters, the private-state type, whether it imports
 * node:*, and which witnesses object it exports for this contract
 * (`witnesses`, or `<contract>Witnesses` when one file serves several
 * contracts, as in shielded-chips). Returns null if the file doesn't exist.
 */
export function scanWitnessesTs(exampleDir, managed) {
  const file = path.join(exampleDir, 'contract', 'witnesses.ts');
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const factoryMatch = src.match(/export const (create\w*PrivateState)\s*=\s*\(([^)]*)\)/);
  const factoryParams = factoryMatch ? factoryMatch[2].replace(/\s+/g, ' ').replace(/,\s*$/, '').trim() : '';
  const perContract = `${managed.replace(/[-_](\w)/g, (_, c) => c.toUpperCase())}Witnesses`;
  const exported = new Set([...src.matchAll(/export const (\w+)\b/g)].map((m) => m[1]));
  return {
    file,
    src,
    factory: factoryMatch?.[1] ?? null,
    factoryParams,
    importsNode: /from\s+['"]node:/.test(src),
    privateStateType: src.match(/export type (\w+PrivateState)\b/)?.[1] ?? null,
    perContract,
    witnessesExport: ['witnesses', perContract].find((n) => exported.has(n)) ?? null,
  };
}

/**
 * The constructor's parameters as written in the Compact source:
 * [{ name, type }], e.g. [{ name: 'acceptedColor', type: 'Bytes<32>' }].
 * Empty when there is no constructor or it takes none.
 */
export function compactConstructorParams(compactSrc) {
  const src = compactSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = src.match(/\bconstructor\s*\(([^)]*)\)/);
  if (!m || !m[1].trim()) return [];
  return splitTopLevel(m[1]).map((p) => {
    const i = p.indexOf(':');
    return { name: p.slice(0, i).trim(), type: p.slice(i + 1).trim() };
  });
}

/** Splits on commas that aren't inside <...>, [...] or (...). */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('<[('.includes(ch)) depth++;
    if ('>])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * A placeholder TypeScript value for a Compact type written in source, used
 * for generated constructor arguments: zeros of the right shape, which
 * type-check and satisfy the runtime's length checks. Types it can't build
 * (user structs, enums) become `undefined as never`, which type-checks and
 * fails loudly at run time; the generated TODO names them.
 */
export function placeholderForCompactType(type) {
  const t = type.trim();
  let m;
  if ((m = t.match(/^Bytes<\s*(\d+)\s*>$/))) return `new Uint8Array(${m[1]})`;
  if (/^(Uint<.*>|Field)$/.test(t)) return '0n';
  if (t === 'Boolean') return 'false';
  if (/^Opaque<\s*"string"\s*>$/.test(t)) return "''";
  if ((m = t.match(/^Vector<\s*(\d+)\s*,(.*)>$/))) {
    const n = Number(m[1]);
    const el = placeholderForCompactType(m[2]);
    return n <= 4 ? `[${Array(n).fill(el).join(', ')}]` : `Array.from({ length: ${n} }, () => ${el})`;
  }
  if (/^(ZswapCoinPublicKey|UserAddress|ContractAddress)$/.test(t)) return '{ bytes: new Uint8Array(32) }';
  return 'undefined as never';
}
