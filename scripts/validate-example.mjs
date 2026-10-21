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

// The devnet gate for one example: compile → env:up → wait:dust → test:local,
// then env:down. Every example's `validate` script runs this from its own
// directory:
//
//   yarn validate [--keep-net] [--report <file>]
//
// A thin wrapper over mnkit's validate command
// (packages/mnkit/src/commands/validate.mjs), which documents the flags. It
// exits with the status of the first step that failed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../packages/mnkit/src/commands/validate.mjs';
import { preflight } from '../packages/mnkit/src/lib/preflight.mjs';
import { exitOnError, fail } from '../packages/mnkit/src/lib/template.mjs';

exitOnError();

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_DIR = process.cwd();
const USAGE = 'Usage: yarn validate [--keep-net] [--report <file>]';

const args = process.argv.slice(2);
let keepNet = false;
let reportPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keep-net') keepNet = true;
  else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) reportPath = path.resolve(args[++i]);
  else fail(`unknown or incomplete argument: ${args[i]}. ${USAGE}`);
}

if (!fs.existsSync(path.join(EXAMPLE_DIR, 'compose.yml'))) {
  fail('run this from an example directory (one with a compose.yml), via `yarn validate`.');
}
preflight(REPO_ROOT, { compact: true, docker: true });

process.exitCode = await validate({ dir: EXAMPLE_DIR, pm: 'yarn', keepNet, reportPath });
