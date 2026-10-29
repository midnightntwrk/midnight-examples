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

// The environment a project's deploy and devnet tests see for a network, so
// `mnkit doctor --network` and deploy's checks read the same settings as
// scripts/deploy.ts and vitest.config.ts. Both load them with Vite's loadEnv;
// this reads the same files in the same order, without Vite.
// Zero dependencies — Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * The directory a project's env files live in: the project itself when it is
 * standalone (has a mnkit.json), else the repository root above it (a monorepo
 * example's vitest.config.ts reads the root's), else `dir`.
 */
export function envDir(dir) {
  const start = path.resolve(dir);
  if (fs.existsSync(path.join(start, 'mnkit.json'))) return start;
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return start;
  }
}

/** The files Vite's loadEnv reads for `mode`, lowest precedence first. */
export const envFiles = (mode) => ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];

/**
 * `env` (the process environment by default) over the project's env files for
 * `network`: a variable already set wins, as in scripts/deploy.ts. Returns the
 * merged `env` and, in `from`, the file each file-set key came from.
 */
export function loadNetworkEnv(dir, network, env = process.env) {
  const root = envDir(dir);
  const fromFiles = {};
  const from = {};
  for (const name of envFiles(network)) {
    const file = path.join(root, name);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
      fromFiles[key] = value;
      from[key] = file;
    }
  }
  for (const key of Object.keys(env)) if (env[key] !== undefined) delete from[key];
  return { env: { ...fromFiles, ...env }, from };
}
