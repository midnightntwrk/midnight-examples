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

// Compiles every contract of one example. An example's `compile` and
// `compile:fast` scripts run this from its own directory:
//
//   npm run compile        → node ../../scripts/compile-contracts.mjs
//   npm run compile:fast   → node ../../scripts/compile-contracts.mjs --skip-zk
//
// A thin wrapper over mnkit's compile command (packages/mnkit/src/commands/compile.mjs).
// It runs the default compiler, which CI sets to the pin.

import { compile } from '../packages/mnkit/src/commands/compile.mjs';
import { exitOnError, fail } from '../packages/mnkit/src/lib/template.mjs';

exitOnError();

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--skip-zk');
if (unknown.length) fail(`unknown argument(s): ${unknown.join(' ')}. Usage: compile-contracts.mjs [--skip-zk]`);
process.exitCode = await compile(process.cwd(), { skipZk: args.includes('--skip-zk') });
