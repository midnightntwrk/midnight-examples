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

// The design-card helpers the pipeline scaffolds from: the Witnesses choice
// and the review mark, against the worked example's real card.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardWitnesses, lintDesign, reviewMark } from '../src/lib/spec-lint.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const tipJar = fs.readFileSync(path.join(REPO, 'examples', 'private-tip-jar', 'SPEC.md'), 'utf8');
const noWitnesses = tipJar.replace(/## Witnesses\n[\s\S]*?(?=\n## )/, '## Witnesses\n\nNone.\n');

describe('cardWitnesses', () => {
  it('reads the Witnesses section', () => {
    expect(cardWitnesses(tipJar)).toBe(true);
    expect(cardWitnesses(noWitnesses)).toBe(false);
    expect(cardWitnesses('# SPEC — x\n\n## Purpose\n\nSomething.\n')).toBe(null);
  });

  it('agrees with the --witnesses check in lintDesign', () => {
    expect(lintDesign(tipJar, { witnessesFlag: cardWitnesses(tipJar) })).toEqual([]);
    expect(lintDesign(tipJar, { witnessesFlag: false })).toContain('"## Witnesses" lists witnesses, but --witnesses was not given');
  });
});

describe('reviewMark', () => {
  const reviewed = tipJar.replace(/^(# .+\n)/, '$1\nReviewed-by: Alice Reviewer, 2026-11-18\n');

  it('finds the line between the title and the first section', () => {
    expect(reviewMark(tipJar)).toBe(null);
    expect(reviewMark(reviewed)).toEqual({ by: 'Alice Reviewer', date: '2026-11-18' });
  });

  it('ignores it inside a section, in a comment, or without a date', () => {
    expect(reviewMark(tipJar.replace('## Purpose\n', '## Purpose\n\nReviewed-by: someone, 2026-11-18\n'))).toBe(null);
    expect(reviewMark(tipJar.replace(/^(# .+\n)/, '$1<!-- Reviewed-by: someone, 2026-11-18 -->\n'))).toBe(null);
    expect(reviewMark(tipJar.replace(/^(# .+\n)/, '$1Reviewed-by: someone\n'))).toBe(null);
  });

  it('leaves the design lint unchanged', () => {
    expect(lintDesign(reviewed)).toEqual(lintDesign(tipJar));
  });
});
