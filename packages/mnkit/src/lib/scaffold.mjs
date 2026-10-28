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
//   monorepo    an example inside midnight-examples (new-example.mjs): the
//               runtime packages as workspaces, the repo's scripts, the
//               repo-root .env
//   standalone  a plain npm project (mnkit init): the runtime packages from
//               npm, `mnkit` scripts, an inlined tsconfig, its own .env
//
// The template holds both. Text files mark mode-only lines with whole-line
// `@if monorepo` / `@if standalone` … `@endif` markers in any comment syntax
// (selectBlocks). Files only one mode gets are listed in MODE_FILES, and the standalone package.json is rewritten
// from the template's (standalonePackageJson).
// Zero dependencies — Node built-ins only.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { sealRegions } from './derive.mjs';
import { assertNoLeftoverTokens, deriveNames, fail, renderTree, substituteNames, toLf } from './template.mjs';
import { loadToolchain } from './toolchain.mjs';

export const KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__PRIVATE_STATE_IMPORT__',
  '__DEPLOY_PS_IMPORT__',
  '__INITIAL_PRIVATE_STATE__',
  '__SIM_WITNESS_IMPORT__',
  '__SIM_WITNESSES__',
  '__TC_LANGUAGE__',
  '__TC_COMPILER__',
  '__TC_MIDNIGHT_JS__',
  '__TC_WALLET_SDK__',
  '__TC_NODE__',
];

export const MODES = ['monorepo', 'standalone'];

/** The runtime packages a project depends on, versioned with mnkit. */
export const RUNTIME_PACKAGES = ['@midnightntwrk/mnkit-coins', '@midnightntwrk/mnkit-sim', '@midnightntwrk/mnkit-wallet'];

/** Runtime packages' earlier names → their names now (mnkit upgrade moves a project's dependencies and imports). */
export const RENAMED_PACKAGES = {
  '@midnight-ntwrk/mnkit-coins': '@midnightntwrk/mnkit-coins',
  '@midnight-ntwrk/mnkit-sim': '@midnightntwrk/mnkit-sim',
  '@midnight-ntwrk/mnkit-wallet': '@midnightntwrk/mnkit-wallet',
};

/**
 * Template files only one mode gets: `skip` in the other mode; in standalone,
 * `rename` gives the output path (npm drops a published .gitignore, so the
 * template ships `gitignore`).
 */
const MODE_FILES = {
  // The repo has one root `npm run fund:wallet` for every example.
  monorepo: { skip: ['gitignore', 'tsconfig.standalone.json', path.join('scripts', 'fund-wallet.ts')] },
  standalone: {
    skip: ['.envrc', 'tsconfig.json', `tutorials${path.sep}`],
    rename: { gitignore: '.gitignore', 'tsconfig.standalone.json': 'tsconfig.json' },
  },
};

/**
 * The project files the developer owns from the start: the contracts, the
 * tests, the README and SPEC. package.json is shared: `upgrade` merges the
 * pins and mnkit's scripts into it. Every other file is template-owned:
 * mnkit.json records its hash, and `upgrade` re-renders it if it is unedited.
 */
const SEED_PREFIXES = ['contract/', 'src/test/'];
const SEED_FILES = ['README.md', 'SPEC.md', 'package.json', 'mnkit.json'];

/** Whether `rel` (a project path, either separator) is template-owned. */
export const isTemplateOwned = (rel) => {
  const posix = rel.split(path.sep).join('/');
  return !SEED_FILES.includes(posix) && !SEED_PREFIXES.some((p) => posix.startsWith(p));
};

/**
 * Seed files the template gained after projects were first scaffolded from it.
 * `upgrade` writes one into a project that doesn't have it; from then on it is
 * the developer's, like any seed file.
 */
export const LATE_SEEDS = ['contract/deploy-args.ts'];

/** The pins a standalone project uses, as mnkit.json records them: not the repo's comment or CI npm. */
export const projectToolchain = (tc) => Object.fromEntries(Object.entries(tc).filter(([k]) => k !== '$comment' && k !== 'npmCli'));

/** sha256 of a file's content with LF line endings, as mnkit.json records it. */
export const fileHash = (content) => createHash('sha256').update(toLf(content)).digest('hex');

/**
 * The mnkit.json `files` map: POSIX path → sha256 of every template-owned file
 * in `files` (`[{ rel, content }]`), sorted by path.
 */
export const ownedFileHashes = (files) =>
  Object.fromEntries(
    files
      .filter((f) => isTemplateOwned(f.rel))
      .map((f) => [f.rel.split(path.sep).join('/'), fileHash(f.content)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

/** The package.json fields `mnkit upgrade` merges three-way. */
export const PACKAGE_BASE_FIELDS = ['dependencies', 'devDependencies', 'scripts', 'overrides', 'engines'];

/**
 * A rendered package.json's PACKAGE_BASE_FIELDS, as mnkit.json records them
 * under `packageBase`: the base `upgrade` compares the developer's
 * package.json and the new render against.
 */
export const packageBaseOf = (content) => {
  const pkg = JSON.parse(content);
  return Object.fromEntries(PACKAGE_BASE_FIELDS.filter((k) => pkg[k] !== undefined).map((k) => [k, pkg[k]]));
};

// A marker is a line of its own: the marker inside //, #, <!-- --> or {/* */},
// or after the * of a block-comment line.
// Other `@if <cond>` blocks (the UI template's `@if ledger`) pass through
// untouched; the stack pairs each @endif with its own @if.
const MARKER_RE = /^\s*(?:\/\/|#|<!--|\{\/\*|\*)\s*@(?:if (\w+)|endif)\s*(?:-->|\*\/\})?\s*$/;
const LOOSE_MARKER_RE = /@(?:if (?:monorepo|standalone)|endif)\b/;

/** Keeps the lines of `mode`'s blocks and every unmarked line; drops the mode marker lines. */
export function selectBlocks(content, mode, rel = 'template') {
  const out = [];
  const open = []; // the @if conditions around the current line, innermost last
  const modeBlock = () => open.find((c) => MODES.includes(c));
  for (const line of content.split('\n')) {
    const marker = line.match(MARKER_RE);
    if (!marker) {
      if (LOOSE_MARKER_RE.test(line)) fail(`${rel}: a mode marker must be alone on its line: ${line.trim()}`);
      if (!modeBlock() || modeBlock() === mode) out.push(line);
      continue;
    }
    const cond = marker[1];
    if (cond) {
      if (MODES.includes(cond) && modeBlock()) fail(`${rel}: @if ${cond} inside @if ${modeBlock()}`);
      open.push(cond);
      if (!MODES.includes(cond) && (!modeBlock() || modeBlock() === mode)) out.push(line);
    } else {
      if (open.length === 0) fail(`${rel}: @endif without @if`);
      const closed = open.pop();
      if (!MODES.includes(closed) && (!modeBlock() || modeBlock() === mode)) out.push(line);
    }
  }
  if (open.length) fail(`${rel}: @if ${open.at(-1)} has no @endif`);
  return out.join('\n');
}

/** The tokens filled from toolchain.json. */
const toolchainTokens = (tc) => ({
  __TC_LANGUAGE__: tc.compact.language,
  __TC_COMPILER__: tc.compact.compiler,
  __TC_MIDNIGHT_JS__: tc.npm['midnight-js'],
  __TC_WALLET_SDK__: tc.npm['wallet-sdk'],
  __TC_NODE__: tc.node,
});

/**
 * toolchain.json's overrides as npm `overrides` (the root package.json's and a
 * standalone project's): a `parent/child` key, which pins `child` only where
 * `parent` depends on it, becomes `{ parent: { child } }`.
 */
export function npmOverrides(overrides) {
  const out = {};
  for (const [key, version] of Object.entries(overrides)) {
    const m = /^((?:@[^/]+\/)?[^/@]+)\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (m) out[m[1]] = { ...out[m[1]], [m[2]]: version };
    else out[key] = version;
  }
  return out;
}

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
    'fund:wallet': 'vite-node scripts/fund-wallet.ts',
    deploy: 'mnkit deploy',
    'deploy:preview': 'mnkit deploy --network preview',
    'deploy:preprod': 'mnkit deploy --network preprod',
    'doctor:preview': 'mnkit doctor --network preview',
    'doctor:preprod': 'mnkit doctor --network preprod',
  };
  const dependencies = Object.fromEntries(
    Object.entries(p.dependencies).map(([pkg, spec]) => {
      if (!RUNTIME_PACKAGES.includes(pkg)) return [pkg, spec];
      if (!specs[pkg]) fail(`template package.json: no version for runtime package ${pkg}`);
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
      overrides: npmOverrides(tc.overrides),
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
      .replaceAll('__DEPLOY_PS_IMPORT__', `import { create${Name}PrivateState } from './witnesses.js';`)
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
      .replaceAll('__DEPLOY_PS_IMPORT__\n', '')
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
 * adds mnkit.json: the project name `mnkit derive` reads, the toolchain it
 * was rendered with, and the hashes of the template-owned files (`upgrade`).
 */
export function renderExample(
  templateDir,
  { name, witnesses = false, spec = null, mode = 'monorepo', tc = loadToolchain(), specs, mnkitVersion },
) {
  if (!MODES.includes(mode)) fail(`unknown mode '${mode}'`);
  const names = deriveNames(name);
  const { skip = [], rename = {} } = MODE_FILES[mode];
  const tokens = toolchainTokens(tc);
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
    const manifest = {
      name,
      template: 'example',
      witnesses,
      mnkit: mnkitVersion,
      toolchain: projectToolchain(tc),
      files: ownedFileHashes(files),
      packageBase: { 'package.json': packageBaseOf(files.find((f) => f.rel === 'package.json').content) },
    };
    files.push({ templateRel: null, rel: 'mnkit.json', content: `${JSON.stringify(manifest, null, 2)}\n` });
  }
  return files;
}
