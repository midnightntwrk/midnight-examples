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

// The toolchain mnkit generates for: toolchain.json, the repo's one pin file.
// A packed mnkit carries a copy at its root (prepack copies it in); inside the
// monorepo the package reads the repo root's.
// Zero dependencies — Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cached = null;
export function loadToolchain() {
  if (cached) return cached;
  const file = [path.join(PKG_ROOT, 'toolchain.json'), path.join(PKG_ROOT, '..', '..', 'toolchain.json')].find((f) =>
    fs.existsSync(f),
  );
  if (!file) throw new Error(`toolchain.json not found next to ${PKG_ROOT}: this mnkit install is broken.`);
  cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cached;
}

/** mnkit's own version, which is also the version of the runtime packages it pins. */
export const mnkitVersion = () => JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

/**
 * The version spec toolchain `tc` pins `pkg` to in a package.json, or null if
 * it doesn't pin it. Exact: every midnight-js-* package (network-id has its
 * own pin while it has no final of the Midnight.js release), testkit-js,
 * wallet-sdk and the wallet-sdk-* packages `npm` names, dapp-connector-api,
 * the packages in `overrides` (ledger-v9 and its runtimes) and vite (vitest's
 * peer, and the UIs' bundler: one Vite for the whole project, so npm hoists
 * the same one). vitest is a caret range on the pinned floor. In
 * peerDependencies (`peer`), an exact pin becomes a tilde range, so a project
 * can pick up patch releases without a peer conflict.
 *
 * Scopes: Midnight.js, testkit-js and dapp-connector-api are still on
 * @midnight-ntwrk; the wallet SDK and the ledger packages are on
 * @midnightntwrk.
 */
export function pinFor(tc, pkg, { peer = false } = {}) {
  const pin = (() => {
    if (pkg === '@midnight-ntwrk/midnight-js-network-id') return tc.npm['midnight-js-network-id'] ?? tc.npm['midnight-js'];
    if (pkg.startsWith('@midnight-ntwrk/midnight-js-')) return tc.npm['midnight-js'];
    if (pkg === '@midnight-ntwrk/testkit-js') return tc.npm['testkit-js'];
    if (pkg === '@midnightntwrk/wallet-sdk') return tc.npm['wallet-sdk'];
    // The sub-packages version on their own; pin the ones a project imports.
    if (pkg.startsWith('@midnightntwrk/wallet-sdk-')) return tc.npm[pkg.slice('@midnightntwrk/'.length)] ?? null;
    if (pkg === '@midnight-ntwrk/dapp-connector-api') return tc.npm['dapp-connector-api'];
    if (/^@midnight-?ntwrk\//.test(pkg) && typeof tc.overrides?.[pkg] === 'string') return tc.overrides[pkg];
    if (pkg === 'vite') return tc.npm.vite;
    if (pkg === 'vitest') return `^${tc.npm.vitest}`;
    return null;
  })();
  return pin && peer && !pin.startsWith('^') ? `~${pin}` : pin;
}
