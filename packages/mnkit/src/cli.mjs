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

// The mnkit command line. Each command lives in commands/; this parses the
// arguments, finds the project, and maps a command's result to an exit code.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compile } from './commands/compile.mjs';
import { runDerive } from './commands/derive.mjs';
import { doctor } from './commands/doctor.mjs';
import { init, printNextSteps } from './commands/init.mjs';
import { validate } from './commands/validate.mjs';
import { checkCompactVersion, checkDocker } from './lib/preflight.mjs';
import { fail } from './lib/template.mjs';
import { loadToolchain, mnkitVersion } from './lib/toolchain.mjs';

const USAGE = `Usage: mnkit <command> [options]

Commands:
  init <dir>        scaffold a project around your contract
                    (--witnesses: the contract has witnesses; --name <name>: project name,
                    default the directory's; --dry-run: list the files; --skip-install)
  compile           compile every contract under contract/ (--skip-zk: no proving keys)
  derive            fill the generated stubs from the compiled contract (safe to re-run)
  validate          compile, start a local network, wait for DUST, run the devnet tests
                    (--keep-net: leave the network up; --report <file>: write a JSON report)
  doctor            check Node, Docker, the Compact compiler and the local ports

Options:
  -h, --help        show this help
  -v, --version     show the mnkit version`;

/** The project's name: mnkit.json's, written by init, else the directory's. */
export function projectName(dir) {
  const manifest = path.join(dir, 'mnkit.json');
  if (fs.existsSync(manifest)) {
    const { name } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (name) return name;
  }
  return path.basename(dir);
}

const COMMANDS = {
  compile: {
    options: { 'skip-zk': { type: 'boolean' } },
    run: ({ values }) => compile(process.cwd(), { skipZk: values['skip-zk'], version: loadToolchain().compact.compiler }),
  },
  derive: {
    options: {},
    run: () => {
      runDerive(process.cwd(), projectName(process.cwd()), { next: 'npm run typecheck && npm run test:sim' });
      return 0;
    },
  },
  validate: {
    options: { 'keep-net': { type: 'boolean' }, report: { type: 'string' } },
    run: async ({ values }) => {
      const dir = process.cwd();
      if (!fs.existsSync(path.join(dir, 'compose.yml'))) fail('run this from a project directory (one with a compose.yml).');
      const problems = [checkCompactVersion(loadToolchain().compact.compiler), checkDocker()].filter(Boolean);
      if (problems.length) fail(`validate needs:\n  - ${problems.join('\n  - ')}`);
      return validate({
        dir,
        pm: 'npm',
        keepNet: values['keep-net'],
        reportPath: values.report ? path.resolve(values.report) : null,
      });
    },
  },
  init: {
    options: {
      witnesses: { type: 'boolean' },
      name: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'skip-install': { type: 'boolean' },
    },
    run: async ({ values, positionals }) => {
      if (positionals.length !== 1) fail('mnkit init takes one directory: mnkit init my-app');
      const opts = { witnesses: values.witnesses, name: values.name, dryRun: values['dry-run'], skipInstall: values['skip-install'] };
      const { dir } = init(positionals[0], opts);
      if (!opts.dryRun) await printNextSteps(dir, opts);
      return 0;
    },
  },
  doctor: { options: {}, run: () => doctor() },
};

/** Runs one command line; resolves to the exit code. */
export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command === '-v' || command === '--version') {
    console.log(mnkitVersion());
    return 0;
  }
  const spec = COMMANDS[command];
  if (!spec) fail(`unknown command '${command}'.\n\n${USAGE}`);
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: { help: { type: 'boolean', short: 'h' }, ...spec.options }, allowPositionals: true });
  } catch (err) {
    fail(`mnkit ${command}: ${err.message}`);
  }
  if (parsed.values.help) {
    console.log(USAGE);
    return 0;
  }
  return (await spec.run(parsed)) ?? 0;
}
