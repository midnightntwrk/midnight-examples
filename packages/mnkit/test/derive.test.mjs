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

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { derive, fillRegions, sealRegions, stubHash } from '../src/lib/derive.mjs';
import { deriveNames } from '../src/lib/template.mjs';
import { cleanup, scaffoldFixture, snapshot, toCrlf } from './helpers.mjs';

afterEach(cleanup);

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const run = (dir, name) => derive(dir, name, deriveNames(name));
const region = (src, id) => {
  const m = src.match(new RegExp(`// @generated-stub begin ${id} sha=[0-9a-f]+\\n([\\s\\S]*?)\\n?\\s*// @generated-stub end ${id}`));
  return m?.[1] ?? null;
};

describe('fillRegions / sealRegions', () => {
  const sealed = sealRegions(['a', '  // @generated-stub begin r sha=0', '  old', '  // @generated-stub end r', 'b'].join('\n'));

  it('seals a region with the hash of its body', () => {
    expect(sealed).toContain(`// @generated-stub begin r sha=${stubHash('  old')}`);
  });

  it('fills an unedited region and re-hashes it', () => {
    const { out, status, missing } = fillRegions(sealed, { r: (indent) => `${indent}new` });
    expect(status).toEqual({ r: 'filled' });
    expect(missing).toEqual([]);
    expect(out).toContain(`  // @generated-stub begin r sha=${stubHash('  new')}\n  new\n  // @generated-stub end r`);
    expect(fillRegions(out, { r: (indent) => `${indent}new` }).status).toEqual({ r: 'unchanged' });
  });

  it('leaves an edited region alone', () => {
    const edited = sealed.replace('  old', '  mine');
    const { out, status } = fillRegions(edited, { r: () => 'generated' });
    expect(status).toEqual({ r: 'edited' });
    expect(out).toBe(edited);
  });

  it('reports generators whose region was deleted', () => {
    expect(fillRegions('no regions here', { r: () => 'x' }).missing).toEqual(['r']);
  });

  it('writes an empty body as no lines', () => {
    const { out } = fillRegions(sealed, { r: () => '' });
    expect(out).toBe(`a\n  // @generated-stub begin r sha=${stubHash('')}\n  // @generated-stub end r\nb`);
  });

  it('reads CRLF as LF and writes CRLF back', () => {
    const crlf = sealed.replaceAll('\n', '\r\n');
    expect(sealRegions(crlf)).toBe(crlf);
    const { out, status } = fillRegions(crlf, { r: (indent) => `${indent}new` });
    expect(status).toEqual({ r: 'filled' });
    expect(out).toBe(fillRegions(sealed, { r: (indent) => `${indent}new` }).out.replaceAll('\n', '\r\n'));
  });

  it('throws on a begin marker without an end', () => {
    expect(() => fillRegions('// @generated-stub begin r sha=0\nx', {})).toThrow(/no matching end marker/);
  });
});

describe('derive', () => {
  it('fails clearly before compile', () => {
    const dir = scaffoldFixture('hello-world');
    fs.rmSync(path.join(dir, 'contract', 'managed'), { recursive: true });
    expect(() => run(dir, 'hello-world')).toThrow(/no compiled contract/);
  });

  it('derives a contract without witnesses or constructor (hello-world)', () => {
    const dir = scaffoldFixture('hello-world');
    const r = run(dir, 'hello-world');
    expect(r).toMatchObject({ managed: 'hello-world', circuits: ['storeMessage'], witnesses: [], ctorParams: [], secondaries: [] });
    const sim = read(dir, 'src/test/hello-world.sim.test.ts');
    expect(region(sim, 'circuits')).toContain("it.todo('storeMessage(newMessage: Opaque<\"string\">)');");
    expect(region(sim, 'constructor-args')).toBe('');
    expect(region(sim, 'coin-imports')).toBe('');
    expect(region(read(dir, 'src/test/hello-world.test.ts'), 'ledger-fields')).toContain('//   message: Opaque<"string">');
    const deployArgs = read(dir, 'contract/deploy-args.ts');
    expect(region(deployArgs, 'constructor-args')).toBe('');
    expect(region(deployArgs, 'private-state')).toBe('    initialPrivateState: {},');
    expect(region(deployArgs, 'secondary-deploys')).toBe('');
  });

  it('fills constructor args from the Compact source types (private-party)', () => {
    const dir = scaffoldFixture('private-party');
    const r = run(dir, 'private-party');
    expect(r.ctorParams).toEqual(['partySize', 'fee', '_secret']);
    const args = region(read(dir, 'src/test/private-party.test.ts'), 'constructor-args');
    expect(args).toContain('0n, // TODO partySize: Uint<16>');
    expect(args).toContain('0n, // TODO fee: Uint<16>');
    expect(args).toContain('new Uint8Array(32), // TODO _secret: Bytes<32>');
    expect(region(read(dir, 'contract/deploy-args.ts'), 'constructor-args')).toBe(
      [
        '      0n, // TODO partySize: Uint<16>',
        '      0n, // TODO fee: Uint<16>',
        '      new Uint8Array(32), // TODO _secret: Bytes<32>',
      ].join('\n'),
    );
  });

  it('builds placeholders for struct arguments (silent-auction UserAddress)', () => {
    const dir = scaffoldFixture('silent-auction', { witnesses: true });
    run(dir, 'silent-auction');
    expect(region(read(dir, 'src/test/silent-auction.sim.test.ts'), 'constructor-args')).toContain(
      '{ bytes: new Uint8Array(32) }, // TODO address: UserAddress',
    );
  });

  it('gives a struct parameter one argument, though index.d.ts writes it inline (struct-params)', () => {
    const dir = scaffoldFixture('struct-params');
    expect(run(dir, 'struct-params').ctorParams).toEqual(['cfg', 'w', 'coin', 'owner']);
    const want = [
      'undefined as never, // TODO cfg: Limits',
      'undefined as never, // TODO w: Window',
      '{ nonce: new Uint8Array(32), color: new Uint8Array(32), value: 0n }, // TODO coin: ShieldedCoinInfo',
      'new Uint8Array(32), // TODO owner: Bytes<32>',
    ];
    for (const [rel, prefix] of [
      ['src/test/struct-params.sim.test.ts', 'args: ['],
      ['src/test/struct-params.test.ts', 'args: ['],
      ['contract/deploy-args.ts', null],
    ]) {
      const lines = region(read(dir, rel), 'constructor-args')
        .split('\n')
        .map((l) => l.trim());
      expect(lines).toEqual(prefix ? [prefix, ...want, '],'] : want);
    }
  });

  it('gives each private-state factory parameter one placeholder, struct types too', () => {
    const dir = scaffoldFixture('struct-params', { witnesses: true });
    const file = path.join(dir, 'contract', 'witnesses.ts');
    const src = read(dir, 'contract/witnesses.ts');
    const factory = 'export const createStructParamsPrivateState = ()';
    expect(src).toContain(factory);
    fs.writeFileSync(file, src.replace(factory, `${factory.slice(0, -1)}cfg: { a: bigint, b: bigint }, s: Uint8Array)`));
    run(dir, 'struct-params');
    expect(region(read(dir, 'contract/deploy-args.ts'), 'private-state')).toBe(
      '    initialPrivateState: createStructParamsPrivateState(undefined as never /* TODO cfg */, new Uint8Array(32) /* TODO s */),',
    );
  });

  it('wires witnesses, a second contract and the coin helpers (private-tip-jar)', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    const r = run(dir, 'private-tip-jar');
    expect(r.managed).toBe('private-tip-jar');
    expect(r.circuits).toEqual(['tip', 'withdraw']);
    expect(r.pureCircuits).toEqual(['ownerKey']);
    expect(r.witnesses).toEqual(['ownerSecretKey']);
    expect(r.secondaries).toEqual([{ name: 'tip-token', status: 'wired' }]);
    expect(r.unstubbed).toEqual([]);

    const w = region(read(dir, 'contract/witnesses.ts'), 'witnesses');
    expect(w).toContain('export const witnesses: Witnesses<PrivateTipJarPrivateState> = {');
    expect(w).toContain("throw new Error('witness ownerSecretKey is not implemented');");

    expect(region(read(dir, 'contract/index.ts'), 'secondary-contracts')).toContain('export const CompiledTipTokenContract');

    const devnet = read(dir, 'src/test/private-tip-jar.test.ts');
    expect(devnet).toContain("it('deploys tip-token'");
    expect(region(devnet, 'coin-imports')).toContain("from '@midnight-ntwrk/mnkit-coins';");
    expect(region(devnet, 'circuits')).toContain('coin: freshCoin(color, value)');

    const sim = read(dir, 'src/test/private-tip-jar.sim.test.ts');
    expect(region(sim, 'coin-imports')).toBe("import { simCoin } from '@midnight-ntwrk/mnkit-coins';");
    expect(region(sim, 'circuits')).toContain("it.todo('ownerKey(sk: Bytes<32>) (pure)');");
    expect(region(sim, 'privacy')).toContain("toEqual(['owner', 'pot', 'tipColor'])");

    const deployArgs = read(dir, 'contract/deploy-args.ts');
    expect(deployArgs).toContain("import { createPrivateTipJarPrivateState } from './witnesses.js';");
    expect(region(deployArgs, 'deploy-imports')).toContain('type TipTokenContract,');
    expect(region(deployArgs, 'private-state')).toBe('    initialPrivateState: createPrivateTipJarPrivateState(),');
    expect(region(deployArgs, 'constructor-args')).toContain('// TODO acceptedColor: Bytes<32>');
    const tipToken = region(deployArgs, 'secondary-deploys');
    expect(tipToken).toContain("'tip-token': deployable<TipTokenContract>({");
    expect(tipToken).toContain('zkConfigPath: tipTokenZkConfigPath,');
    expect(tipToken).not.toContain('args:');
  });

  it('skips a missing contract/deploy-args.ts and says where to get it', () => {
    const dir = scaffoldFixture('hello-world');
    fs.rmSync(path.join(dir, 'contract', 'deploy-args.ts'));
    const r = run(dir, 'hello-world');
    expect(r.report).toContainEqual({ rel: 'contract/deploy-args.ts', note: expect.stringContaining('`mnkit upgrade` adds it') });
  });

  it('is idempotent: a second run changes nothing', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    run(dir, 'private-tip-jar');
    const first = snapshot(dir);
    const r = run(dir, 'private-tip-jar');
    expect(snapshot(dir)).toEqual(first);
    for (const { status } of r.report) for (const s of Object.values(status ?? {})) expect(s).toBe('unchanged');
  });

  it('derives a CRLF checkout as it does an LF one, and keeps it CRLF', () => {
    const lf = scaffoldFixture('private-tip-jar', { witnesses: true });
    run(lf, 'private-tip-jar');
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    toCrlf(dir);
    run(dir, 'private-tip-jar');
    const want = snapshot(lf);
    for (const [rel, content] of Object.entries(snapshot(dir))) {
      if (rel.startsWith(path.join('contract', 'managed'))) continue;
      expect(content.replace(/\r\n/g, ''), rel).not.toContain('\n');
      expect(content.replaceAll('\r\n', '\n'), rel).toBe(want[rel]);
    }
    const first = snapshot(dir);
    const r = run(dir, 'private-tip-jar');
    expect(snapshot(dir)).toEqual(first);
    for (const { status } of r.report) for (const s of Object.values(status ?? {})) expect(s).toBe('unchanged');
  });

  it('writes nothing when a file has a broken marker', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    const sim = path.join(dir, 'src', 'test', 'private-tip-jar.sim.test.ts');
    fs.writeFileSync(sim, read(dir, 'src/test/private-tip-jar.sim.test.ts').replace(/^\s*\/\/ @generated-stub end privacy\n/m, ''));
    const before = snapshot(dir);
    expect(() => run(dir, 'private-tip-jar')).toThrow(
      'src/test/private-tip-jar.sim.test.ts: @generated-stub begin privacy has no matching end marker; nothing was written',
    );
    expect(snapshot(dir)).toEqual(before);
  });

  it('keeps hand edits and reports witnesses left without a stub', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    run(dir, 'private-tip-jar');
    const file = path.join(dir, 'contract', 'witnesses.ts');
    const edited = read(dir, 'contract/witnesses.ts').replace(/ownerSecretKey: \(\{ privateState \}\) => \{[\s\S]*?\n  \},\n/, '');
    fs.writeFileSync(file, edited);
    const testFile = path.join(dir, 'src', 'test', 'private-tip-jar.test.ts');
    const mine = read(dir, 'src/test/private-tip-jar.test.ts').replace("it.todo('tip(", "it.skip('tip(");
    fs.writeFileSync(testFile, mine);

    const r = run(dir, 'private-tip-jar');
    expect(read(dir, 'contract/witnesses.ts')).toBe(edited);
    expect(read(dir, 'src/test/private-tip-jar.test.ts')).toBe(mine);
    expect(r.report.find((x) => x.rel === 'contract/witnesses.ts').status.witnesses).toBe('edited');
    expect(r.unstubbed).toEqual(['ownerSecretKey']);
  });

  it('asks for --witnesses when the contract declares witnesses', () => {
    const dir = scaffoldFixture('private-tip-jar');
    expect(() => run(dir, 'private-tip-jar')).toThrow(/contract\/witnesses\.ts is missing/);
  });

  it('refuses a second contract that has not been compiled', () => {
    const dir = scaffoldFixture('private-tip-jar', { witnesses: true });
    fs.rmSync(path.join(dir, 'contract', 'managed', 'tip-token'), { recursive: true });
    expect(() => run(dir, 'private-tip-jar')).toThrow(/tip-token\.compact has not been compiled/);
  });
});
