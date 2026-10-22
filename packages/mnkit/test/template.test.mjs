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

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWN_TOKENS, renderExample } from '../src/lib/scaffold.mjs';
import { NAME_RE, deriveNames, renderTree, substituteNames } from '../src/lib/template.mjs';
import { TEMPLATE_DIR, cleanup, tmpDir } from './helpers.mjs';

afterEach(cleanup);

describe('names', () => {
  it('derives the three forms of a kebab-case name', () => {
    expect(deriveNames('private-tip-jar')).toEqual({ name: 'private-tip-jar', Name: 'PrivateTipJar', Title: 'Private Tip Jar' });
    expect(substituteNames('__name__ __Name__ __Title__', deriveNames('a-b'))).toBe('a-b AB A B');
  });

  it.each([
    ['hello-world', true],
    ['v2', true],
    ['Hello', false],
    ['-x', false],
    ['x-', false],
    ['a--b', false],
    ['2x', false],
  ])('NAME_RE %s → %s', (name, ok) => {
    expect(NAME_RE.test(name)).toBe(ok);
  });
});

describe('renderTree', () => {
  it('substitutes __name__ in each path segment and honours skip', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '__name__', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, '__name__', 'sub', '__name__.txt'), 'hi __name__');
    fs.writeFileSync(path.join(dir, 'skip.me'), '');
    const files = renderTree(dir, { name: 'x-y', skip: (r) => r === 'skip.me', render: (c) => c.toUpperCase() });
    expect(files).toEqual([
      { templateRel: path.join('__name__', 'sub', '__name__.txt'), rel: path.join('x-y', 'sub', 'x-y.txt'), content: 'HI __NAME__' },
    ]);
  });
});

describe('renderExample', () => {
  const tokensLeft = (files) =>
    files.flatMap(({ rel, content }) => KNOWN_TOKENS.filter((t) => content.includes(t)).map((t) => `${rel}: ${t}`));

  it('renders the template without leftover tokens or unsealed regions', () => {
    for (const witnesses of [false, true]) {
      const files = renderExample(TEMPLATE_DIR, { name: 'my-app', witnesses });
      expect(tokensLeft(files)).toEqual([]);
      for (const { rel, content } of files) expect(content, rel).not.toMatch(/@generated-stub begin [\w-]+ sha=0$/m);
      const rels = files.map((f) => f.rel);
      expect(rels).toContain(path.join('contract', 'my-app.compact'));
      expect(rels.includes(path.join('contract', 'witnesses.ts'))).toBe(witnesses);
    }
  });

  it('wires the witnesses only with witnesses', () => {
    const index = (witnesses) =>
      renderExample(TEMPLATE_DIR, { name: 'my-app', witnesses }).find((f) => f.rel === path.join('contract', 'index.ts')).content;
    expect(index(true)).toContain('withWitnesses(witnesses)');
    expect(index(false)).toContain('withVacantWitnesses');
    expect(index(false)).not.toContain('./witnesses.js');
  });

  it('uses the given spec verbatim as SPEC.md', () => {
    const files = renderExample(TEMPLATE_DIR, { name: 'my-app', spec: '# __name__ stays\n' });
    expect(files.find((f) => f.rel === 'SPEC.md').content).toBe('# __name__ stays\n');
  });
});
