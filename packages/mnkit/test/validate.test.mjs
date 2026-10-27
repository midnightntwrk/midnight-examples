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

// mnkit validate's step runner, against a project whose npm scripts stand in
// for the devnet: env:up waits, the others record that they ran. The real
// gate needs Docker; scripts/mnkit-e2e.sh --devnet runs it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PKG_ROOT, cleanup, tmpDir } from './helpers.mjs';

afterEach(cleanup);

/** A project whose steps append their names to steps.log; env:up announces itself, then sleeps. */
function project() {
  const dir = tmpDir();
  const log = (name) => `node -e "require('fs').appendFileSync('steps.log', '${name}\\n')"`;
  const scripts = {
    compile: log('compile'),
    'env:up': `${log('env:up')} && node -e "setTimeout(() => {}, 30000)"`,
    'wait:dust': log('wait:dust'),
    'test:local': log('test:local'),
    'env:down': log('env:down'),
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', private: true, scripts }));
  return dir;
}

/** Runs validate in its own process, so a signal to it doesn't reach the test runner. */
function startValidate(dir, opts) {
  const code = `const { validate } = await import(${JSON.stringify(path.join(PKG_ROOT, 'src', 'commands', 'validate.mjs'))});
process.exitCode = await validate(${JSON.stringify({ dir, ...opts })});`;
  return spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, stdio: 'ignore' });
}

const steps = (dir) => (fs.existsSync(path.join(dir, 'steps.log')) ? fs.readFileSync(path.join(dir, 'steps.log'), 'utf8').trim().split('\n') : []);

async function untilStep(dir, step) {
  for (let i = 0; i < 300 && !steps(dir).includes(step); i++) await new Promise((r) => setTimeout(r, 50));
  expect(steps(dir)).toContain(step);
}

describe('mnkit validate', () => {
  for (const [signal, exit] of [
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ]) {
    it(`stops on ${signal}, then takes the network down and writes the report`, async () => {
      const dir = project();
      const reportPath = path.join(dir, 'report.json');
      const child = startValidate(dir, { reportPath });
      await untilStep(dir, 'env:up');
      child.kill(signal);
      const [code] = await once(child, 'exit');
      expect(code).toBe(exit);
      expect(steps(dir)).toEqual(['compile', 'env:up', 'env:down']);
      expect(fs.existsSync(path.join(dir, 'logs', 'compose.log'))).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(report).toMatchObject({ passed: false, failedStep: 'env:up', interrupted: signal, exitCode: exit });
    }, 30_000);
  }

  it('leaves the network up on a signal with keepNet', async () => {
    const dir = project();
    const child = startValidate(dir, { keepNet: true });
    await untilStep(dir, 'env:up');
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    expect(code).toBe(143);
    expect(steps(dir)).toEqual(['compile', 'env:up']);
  }, 30_000);
});
