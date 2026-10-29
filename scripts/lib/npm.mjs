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

// The npm that repo scripts spawn. Zero dependencies.
//
// `npm` on PATH isn't always the npm that ran the script: under
// `npx npm@11.21.0 run …` (CI) PATH still has Node 22's npm 10. npm 10 ignores
// .npmrc's min-release-age and strips the lockfile's `libc` entries, so an
// `npm install` from it rewrites package-lock.json. So spawn the npm in
// `npm_execpath` when there is one, and refuse a lockfile write from an npm
// older than root package.json's devEngines floor.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../packages/mnkit/src/lib/template.mjs';

/** [cmd, argv] that runs npm with `args`: npm_execpath's npm, else PATH's. */
export function npmCommand(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && /^npm-cli\.js$|^npx-cli\.js$/.test(path.basename(execPath))) {
    // npx's npm_execpath is npx-cli.js; npm-cli.js sits beside it.
    return [process.execPath, [path.join(path.dirname(execPath), 'npm-cli.js'), ...args]];
  }
  // No `shell:` option (opengrep flags any non-false value). Windows can only
  // run npm.cmd through cmd.exe, so call it explicitly.
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'npm', ...args]] : ['npm', args];
}

/** The version of the npm that npmCommand runs. */
export function npmVersion() {
  const [cmd, argv] = npmCommand(['--version']);
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Problem string when `version` is below `range` (a `>=X.Y.Z` devEngines range), else null. */
export function npmTooOld(version, range) {
  const min = /^>=\s*(\d+)\.(\d+)\.(\d+)/.exec(range ?? '')?.slice(1).map(Number);
  if (!min) return null;
  const have = (version ?? '').split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((have[i] || 0) > min[i]) return null;
    if ((have[i] || 0) < min[i]) {
      return (
        `npm ${version || '(not found)'} would rewrite package-lock.json: this repo needs npm ${range}. ` +
        'Run `npm install -g npm@11`, or rerun under `npx npm@11 run …`.'
      );
    }
  }
  return null;
}

/** Problem string unless npmCommand's npm meets root package.json's devEngines floor, else null. */
export function lockfileNpmProblem(repoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return npmTooOld(npmVersion(), pkg.devEngines?.packageManager?.version);
}

/** Exit unless the npm can write package-lock.json (see lockfileNpmProblem). */
export function assertLockfileNpm(repoRoot) {
  const problem = lockfileNpmProblem(repoRoot);
  if (problem) fail(problem);
}
