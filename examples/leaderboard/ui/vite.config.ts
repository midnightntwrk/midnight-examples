// This file is part of example-leaderboard.
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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Serve the compiler output as static files. FetchZkConfigProvider requests
  // `<origin>/keys/<circuit>.{prover,verifier}`, `<origin>/zkir/<circuit>.bzkir`
  // and the integrity manifest `<origin>/compiler/contract-manifest.json`,
  // which is the layout of contract/managed/leaderboard. `vite build` copies
  // this directory into dist/, so the deployed site serves the same files.
  // The directory is committed, so the build needs no Compact compiler.
  publicDir: path.resolve(here, '../contract/managed/leaderboard'),
  build: {
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // The ledger and onchain runtime ship as WASM packages and must not be
    // pre-bundled by esbuild.
    exclude: [
      '@midnightntwrk/ledger-v9',
      '@midnightntwrk/onchain-runtime-v4',
      '@midnight-ntwrk/midnight-js-protocol',
    ],
  },
  server: {
    port: 3000,
    fs: {
      // The contract and API live one level up, in examples/leaderboard, and
      // dependencies are hoisted to the repo-root node_modules.
      allow: [path.resolve(here, '../../..')],
    },
  },
});
