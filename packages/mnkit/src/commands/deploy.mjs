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

// `mnkit deploy [--network local|preview|preprod] [--contract <name>]`:
// deploys one contract of the project in `dir` without the UI or the test
// suite. The work happens in the project's scripts/deploy.ts, which runs on
// the project's own SDK pins; this checks the project, compiles first when the
// compiled contract is missing, stale or has no keys (a --skip-zk build has no
// verifier keys to deploy), and runs the script with vite-node.
//
// What gets deployed (constructor arguments, initial private state) is in
// contract/deploy-args.ts. The result is deployments/<network>.json.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { compileIsStale } from '../lib/gates.mjs';
import { fail } from '../lib/template.mjs';
import { compile } from './compile.mjs';

/** The networks deploy targets. Mainnet is refused until mnkit has a mainnet config. */
export const DEPLOY_NETWORKS = ['local', 'preview', 'preprod'];

/** The `// TODO` placeholders derive left in contract/deploy-args.ts. */
export function deployArgsTodos(dir) {
  const src = fs.readFileSync(path.join(dir, 'contract', 'deploy-args.ts'), 'utf8');
  return src.split('\n').filter((l) => /\/\/ TODO\b/.test(l) || /\/\* TODO\b/.test(l)).length;
}

/**
 * Resolves to the exit status of the compile or the deploy script. `compiler`
 * and `spawn` are for tests (compile and spawnSync).
 */
export async function deploy(
  dir,
  { network = 'local', contract = null, version = null, install = true, compiler = compile, spawn = spawnSync } = {},
) {
  if (network === 'mainnet') {
    fail(`mnkit deploy doesn't deploy to mainnet: every deploy there spends real DUST. Networks: ${DEPLOY_NETWORKS.join(', ')}.`);
  }
  if (!DEPLOY_NETWORKS.includes(network)) fail(`unknown network '${network}'. Networks: ${DEPLOY_NETWORKS.join(', ')}.`);
  if (!fs.existsSync(path.join(dir, 'mnkit.json'))) fail('run this from a project mnkit init created (one with a mnkit.json).');
  if (!fs.existsSync(path.join(dir, 'scripts', 'deploy.ts'))) {
    fail('this project has no scripts/deploy.ts. Run `npx mnkit upgrade` to add it.');
  }
  if (!fs.existsSync(path.join(dir, 'contract', 'deploy-args.ts'))) {
    fail('this project has no contract/deploy-args.ts. Run `npx mnkit upgrade` to add it, then `npx mnkit derive`.');
  }
  const viteNode = path.join(dir, 'node_modules', '.bin', 'vite-node');
  if (!fs.existsSync(viteNode)) fail('vite-node is not installed. Run `npm install` in the project first.');

  if (compileIsStale(dir)) {
    console.log('• The compiled contract is missing, older than its source or has no keys: compiling first.');
    const status = await compiler(dir, { version, install });
    if (status !== 0) return status;
  }
  const todos = deployArgsTodos(dir);
  if (todos > 0) {
    console.log(`⚠ contract/deploy-args.ts has ${todos} TODO placeholder(s): they are deployed as written.`);
  }

  const args = ['scripts/deploy.ts', ...(contract ? [contract] : [])];
  console.log(`• MIDNIGHT_NETWORK=${network} vite-node ${args.join(' ')}`);
  const r = spawn(viteNode, args, { cwd: dir, stdio: 'inherit', env: { ...process.env, MIDNIGHT_NETWORK: network } });
  if (r.error) fail(`could not run vite-node: ${r.error.message}`);
  return r.status ?? 1;
}
