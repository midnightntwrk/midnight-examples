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
