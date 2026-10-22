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

// `mnkit init <dir>`: scaffolds a standalone npm project around a contract you
// are about to write: the contract stub, compile scripts, a pinned local
// network (compose.yml), config and providers, an in-memory and a devnet test
// with @generated-stub regions, SPEC.md and AGENTS.md. Then `npm install`.
//
// The runtime packages (@midnight-ntwrk/mnkit-*) and mnkit itself are pinned
// to this mnkit's version. MNKIT_LOCAL_PACKAGES=<dir> pins them to the
// tarballs `npm pack` left in <dir> instead, for testing before a release.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_PACKAGES, renderExample } from '../lib/scaffold.mjs';
import { NAME_RE, fail, writeFiles } from '../lib/template.mjs';
import { PKG_ROOT, loadToolchain, mnkitVersion } from '../lib/toolchain.mjs';
import { runChecks } from './doctor.mjs';

/** The tarball `npm pack` writes for package `pkg` at `version`: @a/b → a-b-<version>.tgz. */
const tarballName = (pkg, version) => `${pkg.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/** Version specs for the runtime packages and mnkit: `^<version>`, or file: tarballs from `localDir`. */
export function packageSpecs(version, localDir = null) {
  const specs = {};
  for (const pkg of [...RUNTIME_PACKAGES, 'mnkit']) {
    if (!localDir) {
      specs[pkg] = `^${version}`;
      continue;
    }
    const tgz = path.resolve(localDir, tarballName(pkg, version));
    if (!fs.existsSync(tgz)) fail(`MNKIT_LOCAL_PACKAGES: ${tgz} not found. Run npm pack for ${pkg} into ${localDir}.`);
    specs[pkg] = `file:${tgz}`;
  }
  return specs;
}

/** Scaffolds (or with dryRun, lists) the project; returns { dir, files }. */
export function init(target, { witnesses = false, dryRun = false, skipInstall = false, name: nameOpt } = {}) {
  if (!target) fail('mnkit init needs a directory: mnkit init my-app');
  const dir = path.resolve(target);
  const name = nameOpt ?? path.basename(dir);
  if (!NAME_RE.test(name)) {
    fail(`invalid project name '${name}'. Use kebab-case: lowercase letters/digits, hyphen-separated (e.g. my-app), or pass --name.`);
  }
  if (fs.existsSync(dir) && (!fs.statSync(dir).isDirectory() || fs.readdirSync(dir).length > 0)) {
    fail(`${target} already exists and is not an empty directory.`);
  }

  const version = mnkitVersion();
  const files = renderExample(path.join(PKG_ROOT, 'templates', 'example'), {
    name,
    witnesses,
    mode: 'standalone',
    tc: loadToolchain(),
    specs: packageSpecs(version, process.env.MNKIT_LOCAL_PACKAGES || null),
    mnkitVersion: version,
  });

  if (dryRun) {
    console.log(`Would create ${dir} (${files.length} files):`);
    for (const f of files) console.log(`  ${f.rel}`);
    return { dir, files };
  }
  writeFiles(dir, files);
  console.log(`✔ Created ${name} (${witnesses ? 'with witnesses' : 'witness-free'}) in ${dir}`);

  if (!skipInstall) {
    console.log('\n▶ npm install');
    const r = spawnSync('npm', ['install'], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0) fail(`npm install failed in ${dir} (exit ${r.status ?? 1}). Fix the problem and run it again there.`);
  }
  return { dir, files };
}

/** Prints the next steps, and any environment problem (doctor) to fix first. */
export async function printNextSteps(dir, { skipInstall }) {
  const rel = path.relative(process.cwd(), dir) || '.';
  const problems = (await runChecks()).filter((c) => !c.ok);
  if (problems.length) {
    console.log('\nFix these before compiling (`npx mnkit doctor` checks again):');
    for (const p of problems) console.log(`  ✖ ${p.name}: ${p.detail}`);
  }
  const name = JSON.parse(fs.readFileSync(path.join(dir, 'mnkit.json'), 'utf8')).name;
  console.log(`
Next:
  cd ${rel}${skipInstall ? '\n  npm install' : ''}
  # write your contract in contract/${name}.compact (and SPEC.md first, if you like)
  npm run compile:fast
  npx mnkit derive        # witness stubs, constructor args, a test per circuit
  npm run typecheck && npm run test:sim
  npm run validate        # compile, local network, DUST, devnet tests
`);
}
