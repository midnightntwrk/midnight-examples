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

import { fileURLToPath } from 'node:url';
import { checkNode, exitOnError, fail } from '../src/lib/template.mjs';

// Errors exit 2: 1 is `upgrade --check`'s "behind".
exitOnError(2);
// Before loading the CLI: its modules import Node APIs an older Node lacks
// (node:util parseEnv), which fail at link time with no useful message.
// template.mjs uses only fs and path.
const tooOld = checkNode(fileURLToPath(new URL('..', import.meta.url)), { who: 'mnkit' });
if (tooOld) fail(tooOld);
const { main } = await import('../src/cli.mjs');
process.exitCode = await main(process.argv.slice(2));
