#!/usr/bin/env node
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

// Copies repo-root files into a package for `npm pack` / `npm publish`, and
// removes them again afterwards. A package's prepack and postpack run it from
// the package directory:
//
//   node ../../scripts/pack-extras.mjs add LICENSE toolchain.json
//   node ../../scripts/pack-extras.mjs remove LICENSE toolchain.json
//
// npm always packs a LICENSE it finds; mnkit also embeds toolchain.json. The
// copies are gitignored, so the repo keeps one of each.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action, ...files] = process.argv.slice(2);
if (!['add', 'remove'].includes(action) || files.length === 0) {
  console.error('✖ Usage: pack-extras.mjs add|remove <repo-root file> ...');
  process.exit(1);
}
for (const f of files) {
  if (action === 'add') fs.copyFileSync(path.join(REPO_ROOT, f), path.join(process.cwd(), f));
  else fs.rmSync(path.join(process.cwd(), f), { force: true });
}
