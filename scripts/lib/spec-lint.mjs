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

// The SPEC.md lint (docs/generation-flow.md, steps 1 and 3c). Zero
// dependencies — Node built-ins only.
//
// lintDesign(src) checks the design card on its own, before any code exists:
// every heading is there and filled in, the tables have rows, and each privacy
// invariant names the test key that will check it.
//
// lintCode(exampleDir) checks that the card and the code agree, once the
// contract compiles: the circuits, ledger fields and witnesses match the
// compiled contract; every assert message is in the card and in an
// expectRejects; every invariant key is in an assertNotInPublicState call;
// every circuit is called in a sim test; and no it.todo is left. Those last
// checks matter because the in-memory gate is what unlocks the UI step: an
// empty or half-written sim suite must not pass it.
//
// Each returns a list of problem strings; empty means it passed.

import fs from 'node:fs';
import path from 'node:path';
import { listCompiled, readContractInfo } from './contract-info.mjs';
import { walk } from './gates.mjs';

export const REQUIRED_SECTIONS = [
  'Purpose',
  'Roles',
  'Public ledger fields',
  'Private state',
  'Circuits',
  'Witnesses',
  'Privacy invariants',
  'Accepted leaks',
  'Out of scope',
];
/** Optional: contracts that exist only so the tests can run (a demo faucet token). */
export const TEST_ONLY_SECTION = 'Test-only contracts';

/** Sections whose content is a table that needs at least one row (or "None."). */
const TABLE_SECTIONS = ['Roles', 'Public ledger fields', 'Circuits', 'Witnesses'];
/** Sections that may not be "None.". */
const NEVER_NONE = ['Purpose', 'Roles', 'Circuits'];

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const isNone = (body) => /^none\.?$/i.test(body.trim());

/** SPEC.md → Map(section title → body without HTML comments). */
export function parseSpec(src) {
  const sections = new Map();
  let current = null;
  for (const line of stripComments(src).split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([k, v]) => [k, v.join('\n').trim()]));
}

/** Data rows of the first Markdown table in a section body: arrays of trimmed cells. */
export function tableRows(body) {
  const rows = (body ?? '')
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|'))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  // Header, then the |---| separator, then data.
  return rows.slice(2).filter((cells) => cells.some((c) => c !== ''));
}

/** The name in a table's first cell: the first `backticked` token, else the first word. */
export function rowName(cell) {
  return (/`([^`]+)`/.exec(cell)?.[1] ?? cell.split(/\s+/)[0] ?? '').trim();
}

/** "- Never on chain: … → `key`, `key2`" bullets: [{ line, keys }]. */
export function invariants(body) {
  return (body ?? '')
    .split('\n')
    .filter((l) => /^\s*-\s*Never on chain:/i.test(l))
    .map((line) => {
      const arrow = /(?:→|->)\s*(.+)$/.exec(line);
      const keys = arrow ? [...arrow[1].matchAll(/`(\w+)`/g)].map((m) => m[1]) : [];
      return { line: line.trim(), keys };
    });
}

/** Contract names listed under "Test-only contracts" (`tip-token` or `tip-token.compact`), one per bullet or row. */
export function testOnlyContracts(sections) {
  const body = sections.get(TEST_ONLY_SECTION);
  if (!body || isNone(body)) return [];
  // The first backticked name on each bullet or table row; later ones describe it.
  return body
    .split('\n')
    .filter((l) => /^\s*[-|]/.test(l) && !/^\s*\|\s*-/.test(l))
    .map((l) => /`([\w-]+?)(?:\.compact)?`/.exec(l)?.[1])
    .filter(Boolean);
}

/**
 * The design card on its own. `witnessesFlag` (true/false), when given, is
 * the scaffold's --witnesses choice, which must match the Witnesses section.
 */
export function lintDesign(src, { witnessesFlag } = {}) {
  const problems = [];
  const empty = new Set();
  const sections = parseSpec(src);
  if (/__\w+__/.test(src)) problems.push('a template token (like __Title__) is still in the file');

  for (const title of REQUIRED_SECTIONS) {
    if (!sections.has(title)) {
      problems.push(`missing section "## ${title}"`);
      continue;
    }
    const body = sections.get(title);
    // The template's placeholder bullets ("-", "- Never on chain:") don't count.
    const filled = body.split('\n').filter((l) => l.trim() && !/^\s*-\s*(Never on chain:)?\s*$/i.test(l));
    if (filled.length === 0) {
      empty.add(title);
      problems.push(`"## ${title}" is empty; fill it in or write "None."`);
      continue;
    }
    if (isNone(body)) {
      if (NEVER_NONE.includes(title)) problems.push(`"## ${title}" can't be "None."`);
      continue;
    }
    if (TABLE_SECTIONS.includes(title) && tableRows(body).length === 0) {
      problems.push(`"## ${title}": the table has no rows; add one per item or write "None."`);
    }
    if (['Accepted leaks', 'Out of scope'].includes(title) && /^\s*-\s*$/m.test(body)) {
      problems.push(`"## ${title}" has an empty bullet`);
    }
  }

  const inv = sections.get('Privacy invariants');
  if (inv !== undefined && !empty.has('Privacy invariants') && !isNone(inv)) {
    const lines = invariants(inv);
    if (lines.length === 0) problems.push('"## Privacy invariants" has no "- Never on chain: …" line (or write "None.")');
    for (const { line, keys } of lines) {
      if (keys.length === 0) {
        problems.push(
          `privacy invariant without a test key: "${line}". End it with → \`key\`, the assertNotInPublicState key that checks it`,
        );
      }
    }
  }

  if (witnessesFlag !== undefined && sections.has('Witnesses')) {
    const declares = !isNone(sections.get('Witnesses')) && tableRows(sections.get('Witnesses')).length > 0;
    if (declares && !witnessesFlag) problems.push('"## Witnesses" lists witnesses, but --witnesses was not given');
    if (!declares && witnessesFlag) problems.push('--witnesses was given, but "## Witnesses" is "None."');
  }
  return problems;
}

/** Index just past the `)` that closes the `(` at `open`, skipping string literals. */
function closingParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
    } else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** The argument text of every `fn(...)` call in src. */
function callArgs(src, fn) {
  const out = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  for (let m; (m = re.exec(src)); ) {
    const open = m.index + m[0].length - 1;
    out.push(src.slice(open + 1, closingParen(src, open) - 1));
  }
  return out;
}

/** The last string literal in a piece of code, unescaped. */
function lastString(code) {
  const all = [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)];
  const m = all.at(-1);
  return m ? (m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1') : null;
}

const stripCode = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every assert message in a Compact source. */
export function compactAsserts(compactSrc) {
  return callArgs(stripCode(compactSrc), 'assert').map(lastString).filter((s) => s !== null);
}

/** Keys of the object literals passed to assertNotInPublicState in a test source. */
export function privacyKeys(testSrc) {
  const keys = new Set();
  for (const args of callArgs(stripCode(testSrc), 'assertNotInPublicState')) {
    const obj = args.slice(args.indexOf('{'));
    for (const m of obj.matchAll(/(?:^|[{,\n])\s*['"]?(\w+)['"]?\s*:/g)) keys.add(m[1]);
  }
  return keys;
}

/**
 * The card against the compiled code of examples/<name>. Run after
 * `yarn compile:fast` and the sim tests are written.
 */
export function lintCode(exampleDir) {
  const problems = [];
  const specPath = path.join(exampleDir, 'SPEC.md');
  if (!fs.existsSync(specPath)) return ['no SPEC.md'];
  const sections = parseSpec(fs.readFileSync(specPath, 'utf8'));
  const testOnly = new Set(testOnlyContracts(sections));
  const compiled = listCompiled(exampleDir);
  if (compiled.length === 0) return ['no compiled contract under contract/managed/: run yarn compile:fast first'];
  for (const c of testOnly) if (!compiled.includes(c)) problems.push(`"## ${TEST_ONLY_SECTION}" lists \`${c}\`, which isn't compiled`);
  const contracts = compiled.filter((c) => !testOnly.has(c));
  const infos = contracts.map((c) => readContractInfo(exampleDir, c));

  const compare = (what, section, inCode, inSpec) => {
    for (const n of inCode) if (!inSpec.has(n)) problems.push(`${what} \`${n}\` is in the contract but not in "## ${section}"`);
    for (const n of inSpec) if (!inCode.has(n)) problems.push(`"## ${section}" lists \`${n}\`, which the contract doesn't have`);
  };
  const specNames = (section) => {
    const body = sections.get(section);
    return new Set(body && !isNone(body) ? tableRows(body).map((r) => rowName(r[0])).filter((n) => n && n !== 'constructor') : []);
  };

  const circuits = infos.flatMap((i) => i.circuits);
  compare('circuit', 'Circuits', new Set(circuits.map((c) => c.name)), specNames('Circuits'));
  compare(
    'ledger field',
    'Public ledger fields',
    new Set(infos.flatMap((i) => i.ledger.filter((l) => l.exported).map((l) => l.name))),
    specNames('Public ledger fields'),
  );
  compare('witness', 'Witnesses', new Set(infos.flatMap((i) => i.witnesses.map((w) => w.name))), specNames('Witnesses'));

  // The sim tests: what the in-memory gate actually ran.
  const simFiles = walk(path.join(exampleDir, 'src'), (n) => n.endsWith('.sim.test.ts'));
  if (simFiles.length === 0) problems.push('no src/**/*.sim.test.ts: the in-memory gate would pass with no tests');
  const sim = simFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const simCode = stripCode(sim);
  if (/\bit\.todo\s*\(/.test(simCode)) problems.push('an it.todo is left in the sim tests');

  for (const c of circuits) {
    const called = c.pure
      ? new RegExp(`\\b${c.name}\\s*\\(`).test(simCode)
      : new RegExp(`\\.call\\(\\s*['"\`]${c.name}['"\`]`).test(simCode);
    if (!called) problems.push(`circuit \`${c.name}\` is never ${c.pure ? 'called' : 'run with .call()'} in a sim test`);
  }

  // Every guard: in the card, and rejected in a sim test.
  const rejected = new Set(callArgs(simCode, 'expectRejects').map(lastString).filter(Boolean));
  const circuitsBody = sections.get('Circuits') ?? '';
  for (const c of contracts) {
    const src = path.join(exampleDir, 'contract', `${c}.compact`);
    if (!fs.existsSync(src)) continue;
    for (const msg of compactAsserts(fs.readFileSync(src, 'utf8'))) {
      if (!circuitsBody.includes(msg)) problems.push(`assert "${msg}" (${c}.compact) is not in the Asserts column of "## Circuits"`);
      if (![...rejected].some((r) => msg.includes(r))) problems.push(`assert "${msg}" (${c}.compact) has no expectRejects in a sim test`);
    }
  }

  // Every privacy invariant: an assertNotInPublicState key.
  const inv = sections.get('Privacy invariants');
  if (inv && !isNone(inv)) {
    const keys = privacyKeys(sim);
    if (keys.size === 0) problems.push('"## Privacy invariants" is not "None.", but no sim test calls assertNotInPublicState');
    for (const { line, keys: want } of invariants(inv)) {
      for (const k of want) {
        if (![...keys].some((t) => t.startsWith(k))) problems.push(`invariant key \`${k}\` is not an assertNotInPublicState key in a sim test ("${line}")`);
      }
    }
  }
  return problems;
}
