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

// mnkit as a library, for tools that build on the engine (the monorepo's
// scripts import the modules directly).

export { compile } from './commands/compile.mjs';
export { deploy } from './commands/deploy.mjs';
export { runDerive } from './commands/derive.mjs';
export { validate } from './commands/validate.mjs';
export { derive, fillRegions, sealRegions, stubHash } from './lib/derive.mjs';
export { renderExample } from './lib/scaffold.mjs';
export { MnkitError, deriveNames } from './lib/template.mjs';
export { loadToolchain, mnkitVersion } from './lib/toolchain.mjs';
