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
import { addContract, printAddContractNextSteps } from './commands/add-contract.mjs';
import { addUi } from './commands/add-ui.mjs';
import { compile } from './commands/compile.mjs';
import { deploy } from './commands/deploy.mjs';
import { runDerive } from './commands/derive.mjs';
import { doctor } from './commands/doctor.mjs';
import { init, printNextSteps } from './commands/init.mjs';
import { upgrade } from './commands/upgrade.mjs';
import { validate } from './commands/validate.mjs';
import { checkDocker } from './lib/preflight.mjs';
import { fail } from './lib/template.mjs';
import { loadToolchain, mnkitVersion } from './lib/toolchain.mjs';

const USAGE = `Usage: mnkit <command> [options]

Commands:
  init <dir>        scaffold a project around your contract
                    (--witnesses: the contract has witnesses; --name <name>: project name,
                    default the directory's; --dry-run: list the files; --skip-install)
  compile           compile every contract under contract/ with the pinned compiler, installing
                    it (and the Compact CLI) when missing (--skip-zk: no proving keys;
                    --no-install, or MNKIT_NO_INSTALL=1: fail instead of installing)
  derive            fill the generated stubs from the compiled contract (safe to re-run)
  validate          compile, start a local network, wait for DUST, run the devnet tests
                    (--keep-net: leave the network up; --report <file>: write a JSON report)
  deploy [name]     deploy the compiled contract to local, preview or preprod, compiling first
                    when needed; writes deployments/<network>.json (name: another contract
                    under contract/, default the project's; --network <net>: default local;
                    arguments and private state come from contract/deploy-args.ts)
  add contract <name>
                    add another contract under contract/ (compile and derive wire it in)
  add ui            add a browser UI in ui/ for the compiled contract (an npm workspace)
                    (--contract <dir>: which contract/managed/<dir>; --private-state
                    memory|persistent; --dry-run; --skip-gate: skip typecheck and test:sim;
                    --skip-install)
  upgrade           move the project to this mnkit's templates and toolchain: re-render the
                    template-owned files you haven't edited, merge package.json
                    (--check: report only, exit 1 if behind; --force: also replace edited
                    files; --skip-install)
  doctor            check Node, Docker, the Compact compiler and the local ports
                    (--network <net>: also check local, preview or preprod: node, indexer
                    and its lag, the proof server's version, preprod's Blockfrost key)

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

/** True when environment variable `name` is set to anything but '' or '0'. */
const envFlag = (name) => !['', '0', undefined].includes(process.env[name]);

/** `mnkit add <what>`: one entry per thing that can be added. */
const ADD = {
  contract: ({ args }) => {
    if (args.length !== 1) fail('mnkit add contract takes one name: mnkit add contract my-token');
    const dir = process.cwd();
    addContract(dir, args[0], { project: projectName(dir) });
    printAddContractNextSteps(args[0]);
    return 0;
  },
  ui: ({ values, args }) => {
    if (args.length) fail('mnkit add ui takes no arguments: run it in the project directory.');
    const dir = process.cwd();
    addUi(dir, {
      name: projectName(dir),
      contract: values.contract ?? null,
      privateState: values['private-state'] ?? null,
      dryRun: values['dry-run'],
      skipGate: values['skip-gate'],
      skipInstall: values['skip-install'],
    });
    return 0;
  },
};

const COMMANDS = {
  add: {
    options: {
      contract: { type: 'string' },
      'private-state': { type: 'string' },
      'dry-run': { type: 'boolean' },
      'skip-gate': { type: 'boolean' },
      'skip-install': { type: 'boolean' },
    },
    run: ({ values, positionals }) => {
      const [what, ...args] = positionals;
      const add = ADD[what];
      if (!add) fail(`mnkit add takes one of: ${Object.keys(ADD).join(', ')}${what ? ` (got '${what}')` : ''}.`);
      return add({ values, args });
    },
  },
  compile: {
    options: { 'skip-zk': { type: 'boolean' }, 'no-install': { type: 'boolean' } },
    run: ({ values }) =>
      compile(process.cwd(), {
        skipZk: values['skip-zk'],
        version: loadToolchain().compact.compiler,
        install: !values['no-install'] && !envFlag('MNKIT_NO_INSTALL'),
      }),
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
      // No compiler check: the compile step installs it, and is skipped when
      // the compiled contract is current.
      const docker = checkDocker();
      if (docker) fail(`validate needs Docker: ${docker}`);
      return validate({
        dir,
        pm: 'npm',
        keepNet: values['keep-net'],
        reportPath: values.report ? path.resolve(values.report) : null,
      });
    },
  },
  deploy: {
    options: { network: { type: 'string' }, 'no-install': { type: 'boolean' } },
    run: ({ values, positionals }) => {
      if (positionals.length > 1) fail('mnkit deploy takes at most one contract: mnkit deploy tip-token');
      return deploy(process.cwd(), {
        network: values.network ?? 'local',
        contract: positionals[0] ?? null,
        version: loadToolchain().compact.compiler,
        install: !values['no-install'] && !envFlag('MNKIT_NO_INSTALL'),
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
  upgrade: {
    options: { check: { type: 'boolean' }, force: { type: 'boolean' }, 'skip-install': { type: 'boolean' } },
    run: ({ values }) =>
      upgrade(process.cwd(), { check: values.check, force: values.force, skipInstall: values['skip-install'] }),
  },
  doctor: {
    options: { network: { type: 'string' } },
    run: ({ values, positionals }) => {
      if (positionals.length) fail('mnkit doctor takes no arguments: mnkit doctor --network preview');
      return doctor({ network: values.network ?? null });
    },
  },
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
