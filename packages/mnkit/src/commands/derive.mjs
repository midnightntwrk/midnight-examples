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

// `mnkit derive`: fills the @generated-stub regions of a scaffolded project
// from its compiled contract (lib/derive.mjs) and prints what it did. Safe to
// re-run: edited regions are left alone.

import { derive } from '../lib/derive.mjs';
import { deriveNames, fail } from '../lib/template.mjs';

/**
 * Derive the project in `dir` named `name`, print the report and return it.
 * `label` names the project in the output (examples/<name> in the monorepo);
 * `next` is the command to run afterwards.
 */
export function runDerive(dir, name, { label = name, next, coinsPackage } = {}) {
  let result;
  try {
    result = derive(dir, name, deriveNames(name), { coinsPackage });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const list = (xs) => (xs.length ? xs.join(', ') : 'none');
  console.log(`\n✔ Derived ${label} from contract/managed/${result.managed}`);
  console.log(`    circuits: ${list(result.circuits)}${result.pureCircuits.length ? `; pure: ${list(result.pureCircuits)}` : ''}`);
  console.log(`    witnesses: ${list(result.witnesses)}`);
  console.log(`    constructor: ${list(result.ctorParams)}`);
  if (result.secondaries.length) {
    console.log(`    other contracts: ${result.secondaries.map((s) => `${s.name} (${s.status})`).join(', ')}`);
  }
  console.log('');
  for (const r of result.report) {
    if (r.note) {
      console.log(`  ${r.rel}: ${r.note}`);
      continue;
    }
    const parts = Object.entries(r.status).map(([id, st]) => `${id} ${st}`);
    if (r.missing.length) parts.push(`no region for ${r.missing.join(', ')} (markers removed: yours now)`);
    console.log(`  ${r.rel}: ${parts.join('; ') || 'no regions'}`);
  }
  if (result.secondaries.some((s) => s.status !== 'wired')) {
    console.log('\n  A contract with witnesses of its own is not wired: contract/witnesses.ts belongs to');
    console.log(`  ${name}.compact. Export it from contract/index.ts and deploy it in the test by hand.`);
  }
  const edited = result.report.flatMap((r) => Object.entries(r.status ?? {}).filter(([, st]) => st === 'edited'));
  if (edited.length) {
    console.log('\n  "edited" regions were changed by hand and left alone. To regenerate one, restore its');
    console.log('  body to the generated text, or delete the body and set its sha= to e3b0c44298fc (empty).');
  }
  if (result.unstubbed.length) {
    console.log(`\n  ⚠ contract/witnesses.ts has no implementation for: ${result.unstubbed.join(', ')}`);
  }
  if (next) console.log(`\n  Next: ${next}\n`);
  return result;
}
