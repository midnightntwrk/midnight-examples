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

// Environment checks shared by the generators and the validate runner.
// Zero dependencies — Node built-ins only.
//
// Each check returns a problem string, or null when it passes. preflight()
// runs the requested ones and fails once with every problem listed, so a
// broken setup costs one round trip instead of one per missing tool.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkNode, fail } from './template.mjs';

/** The pinned compiler version: `compact.compiler` in toolchain.json (`yarn toolchain:check` keeps ci.yaml in step). */
export function pinnedCompactVersion(repoRoot) {
  const file = path.join(repoRoot, 'toolchain.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')).compact?.compiler ?? null;
}

// `compact --version` prints the CLI's own version; the compiler's is
// `compact compile --version`.
export function checkCompact(repoRoot) {
  return checkCompactVersion(pinnedCompactVersion(repoRoot), { asDefault: true });
}

/**
 * A problem string unless compiler `pin` is usable, else null. asDefault: it
 * must be the default compiler (the repo's scripts run plain `compact
 * compile`). Otherwise it only has to be installed: mnkit runs `compact
 * compile +<pin>`, which picks it whatever the default is.
 */
export function checkCompactVersion(pin, { asDefault = false } = {}) {
  const r = spawnSync('compact', ['compile', ...(pin && !asDefault ? [`+${pin}`] : []), '--version'], { encoding: 'utf8' });
  if (r.error) {
    return 'the `compact` CLI is not on PATH. Install it: https://docs.midnight.network/getting-started/installation';
  }
  if (r.status !== 0) {
    return pin && !asDefault
      ? `Compact compiler ${pin} is not installed. Run \`compact update ${pin} --no-set-default\`.`
      : `\`compact compile --version\` failed: ${(r.stderr || r.stdout).trim()}`;
  }
  const found = r.stdout.trim();
  if (pin && found !== pin) {
    return `Compact compiler ${found} is the default, but toolchain.json pins ${pin}. Run \`compact update ${pin}\`.`;
  }
  return null;
}

export function checkDocker() {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (r.error) return 'the `docker` CLI is not on PATH. The local devnet needs Docker.';
  if (r.status !== 0) return 'Docker is installed but the daemon is not reachable. Start Docker and retry.';
  return null;
}

/** Run the requested checks and exit with every problem listed if any fail. */
export function preflight(repoRoot, { compact = false, docker = false } = {}) {
  const problems = [
    checkNode(repoRoot),
    compact ? checkCompact(repoRoot) : null,
    docker ? checkDocker() : null,
  ].filter(Boolean);
  if (problems.length === 1) fail(`preflight: ${problems[0]}`);
  if (problems.length > 1) fail(`preflight failed:\n  - ${problems.join('\n  - ')}`);
}
