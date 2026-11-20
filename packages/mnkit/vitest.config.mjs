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

// The engine tests (test/). Its own config, so vitest run from the repo root
// (which aggregates the examples' suites) does not pick them up.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.mjs'],
    // Some tests spawn the CLI (standalone.test.mjs, compile.test.mjs) and can
    // pass the 5 s default on a busy runner.
    testTimeout: 30_000,
  },
});
