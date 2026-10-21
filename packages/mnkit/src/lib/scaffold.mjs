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

// Renders templates/example for one project name, in memory, in one of two
// modes:
//
//   monorepo    an example inside midnight-examples (new-example.mjs): yarn
//               workspace deps, the repo's scripts, the repo-root .env
//   standalone  a plain npm project (mnkit init): the runtime packages from
//               npm, `mnkit` scripts, an inlined tsconfig, its own .env
//
// The template holds both. Text files mark mode-only lines with whole-line
// `@if monorepo` / `@if standalone` … `@endif` markers in any comment syntax
// (selectBlocks); __RUN__ is the package-script runner. Files only one mode
// gets are listed in MODE_FILES, and the standalone package.json is rewritten
// from the template's (standalonePackageJson).
// Zero dependencies — Node built-ins only.

import path from 'node:path';
import { sealRegions } from './derive.mjs';
import { assertNoLeftoverTokens, deriveNames, fail, renderTree, substituteNames } from './template.mjs';
import { loadToolchain } from './toolchain.mjs';

export const KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__PRIVATE_STATE_IMPORT__',
  '__INITIAL_PRIVATE_STATE__',
  '__SIM_WITNESS_IMPORT__',
  '__SIM_WITNESSES__',
  '__RUN__',
  '__TC_LANGUAGE__',
  '__TC_COMPILER__',
  '__TC_MIDNIGHT_JS__',
  '__TC_WALLET_SDK__',
  '__TC_NODE__',
];

export const MODES = ['monorepo', 'standalone'];

/** The runtime packages a project depends on, versioned with mnkit. */
export const RUNTIME_PACKAGES = ['@midnight-ntwrk/mnkit-coins', '@midnight-ntwrk/mnkit-sim', '@midnight-ntwrk/mnkit-wallet'];

/**
 * Template files only one mode gets: `skip` in the other mode; in standalone,
 * `rename` gives the output path (npm drops a published .gitignore, so the
 * template ships `gitignore`).
 */
const MODE_FILES = {
  monorepo: { skip: ['gitignore', 'tsconfig.standalone.json'] },
  standalone: {
    skip: ['.envrc', 'tsconfig.json', `tutorials${path.sep}`],
    rename: { gitignore: '.gitignore', 'tsconfig.standalone.json': 'tsconfig.json' },
  },
};

// A marker is a line of its own: the marker inside //, #, <!-- --> or {/* */}.
const MARKER_RE = /^\s*(?:\/\/|#|<!--|\{\/\*)\s*@(if (monorepo|standalone)|endif)\s*(?:-->|\*\/\})?\s*$/;
const LOOSE_MARKER_RE = /@(?:if (?:monorepo|standalone)|endif)\b/;

/** Keeps the lines of `mode`'s blocks and every unmarked line; drops the marker lines. */
export function selectBlocks(content, mode, rel = 'template') {
  const out = [];
  let block = null;
  for (const line of content.split('\n')) {
    const marker = line.match(MARKER_RE);
    if (!marker && LOOSE_MARKER_RE.test(line)) fail(`${rel}: a mode marker must be alone on its line: ${line.trim()}`);
    const open = marker?.[2] ? [null, marker[2]] : null;
    if (open) {
      if (block) fail(`${rel}: @if ${open[1]} inside @if ${block}`);
      block = open[1];
    } else if (marker) {
      if (!block) fail(`${rel}: @endif without @if`);
      block = null;
    } else if (!block || block === mode) out.push(line);
  }
  if (block) fail(`${rel}: @if ${block} has no @endif`);
  return out.join('\n');
}

/** The tokens filled from toolchain.json and the mode. */
const toolchainTokens = (mode, tc) => ({
  __RUN__: mode === 'standalone' ? 'npm run' : 'yarn',
  __TC_LANGUAGE__: tc.compact.language,
  __TC_COMPILER__: tc.compact.compiler,
  __TC_MIDNIGHT_JS__: tc.npm['midnight-js'],
  __TC_WALLET_SDK__: tc.npm['wallet-sdk'],
  __TC_NODE__: tc.node,
});

/**
 * The template's package.json, as a standalone npm project: named after the
 * project, `mnkit` scripts, the runtime packages and mnkit at `specs` (a
 * package name → version spec map, e.g. '^0.1.0' or 'file:/…/x.tgz'), and
 * the toolchain's overrides.
 */
export function standalonePackageJson(templatePkg, { name, specs, tc }) {
  const p = JSON.parse(templatePkg);
  const test = p.scripts.test;
  const scripts = {
    ...p.scripts,
    compile: 'mnkit compile',
    'compile:fast': 'mnkit compile --skip-zk',
    derive: 'mnkit derive',
    'test:local': `MIDNIGHT_NETWORK=local ${test}`,
    'test:preview': `MIDNIGHT_NETWORK=preview ${test}`,
    'test:preprod': `MIDNIGHT_NETWORK=preprod ${test}`,
    validate: 'mnkit validate',
  };
  const dependencies = Object.fromEntries(
    Object.entries(p.dependencies).map(([pkg, spec]) => {
      if (!spec.startsWith('workspace:')) return [pkg, spec];
      if (!specs[pkg]) fail(`template package.json: no version for workspace dependency ${pkg}`);
      return [pkg, specs[pkg]];
    }),
  );
  const devDependencies = Object.fromEntries(
    Object.entries({ ...p.devDependencies, mnkit: specs.mnkit }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: { node: `>=${tc.node}.0.0` },
      scripts,
      dependencies,
      devDependencies,
      overrides: tc.overrides,
    },
    null,
    2,
  )}\n`;
}

/** The template text with the name and witness tokens replaced. */
export function substituteExample(content, { names, witnesses }) {
  const { Name } = names;
  // 1) Plain name tokens (case-sensitive, non-overlapping).
  let out = substituteNames(content, names);

  // 2) Witness markers. Values are pre-resolved so ordering is irrelevant.
  if (witnesses) {
    out = out
      .replaceAll('__WITNESS_IMPORT__', "import { witnesses } from './witnesses.js';")
      .replaceAll('__WITNESS_METHOD__', 'withWitnesses(witnesses)')
      .replaceAll(
        '__PRIVATE_STATE_IMPORT__',
        `import { create${Name}PrivateState } from '../../contract/witnesses.js';`,
      )
      .replaceAll('__INITIAL_PRIVATE_STATE__', `create${Name}PrivateState()`)
      .replaceAll(
        '__SIM_WITNESS_IMPORT__',
        `import { create${Name}PrivateState, witnesses } from '../../contract/witnesses.js';`,
      )
      .replaceAll('__SIM_WITNESSES__', 'witnesses');
  } else {
    // Drop the whole marker line for the import markers.
    out = out
      .replaceAll('__WITNESS_IMPORT__\n', '')
      .replaceAll('__PRIVATE_STATE_IMPORT__\n', '')
      .replaceAll('__SIM_WITNESS_IMPORT__\n', '')
      .replaceAll('__SIM_WITNESSES__', '{}')
      .replaceAll('__WITNESS_METHOD__', 'withVacantWitnesses')
      .replaceAll('__INITIAL_PRIVATE_STATE__', '{}');
  }
  return out;
}

/**
 * The files of a new project, `[{ templateRel, rel, content }]` (see
 * renderTree). witnesses.ts is left out without `witnesses`; `spec`, when
 * given, is used verbatim as SPEC.md. Every region starts sealed, so derive
 * treats it as unedited. `tc` is the toolchain (toolchain.json). Standalone
 * mode also takes `specs` (standalonePackageJson) and `mnkitVersion`, and
 * adds mnkit.json, the manifest `mnkit derive` reads the project name from.
 */
export function renderExample(
  templateDir,
  { name, witnesses = false, spec = null, mode = 'monorepo', tc = loadToolchain(), specs, mnkitVersion },
) {
  if (!MODES.includes(mode)) fail(`unknown mode '${mode}'`);
  const names = deriveNames(name);
  const { skip = [], rename = {} } = MODE_FILES[mode];
  const tokens = toolchainTokens(mode, tc);
  const files = renderTree(templateDir, {
    name,
    skip: (rel) =>
      (!witnesses && rel === path.join('contract', 'witnesses.ts')) ||
      skip.some((s) => (s.endsWith(path.sep) ? rel.startsWith(s) : rel === s)),
    render: (raw, rel) => {
      if (spec !== null && rel === 'SPEC.md') return spec;
      if (mode === 'standalone' && rel === 'package.json') return standalonePackageJson(raw, { name, specs, tc });
      let content = selectBlocks(raw, mode, rel);
      for (const [token, value] of Object.entries(tokens)) content = content.replaceAll(token, value);
      content = sealRegions(substituteExample(content, { names, witnesses }));
      assertNoLeftoverTokens(rel, content, KNOWN_TOKENS);
      return content;
    },
  }).map((f) => (rename[f.templateRel] ? { ...f, rel: rename[f.templateRel] } : f));
  if (mode === 'standalone') {
    files.push({
      templateRel: null,
      rel: 'mnkit.json',
      content: `${JSON.stringify({ name, template: 'example', witnesses, mnkit: mnkitVersion }, null, 2)}\n`,
    });
  }
  return files;
}
