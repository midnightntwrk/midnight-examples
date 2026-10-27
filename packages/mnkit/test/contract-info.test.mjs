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
import {
  argTypeLiteral,
  compactConstructorParams,
  contractSources,
  isSecretArg,
  listCompiled,
  placeholderForCompactType,
  readConstructor,
  readContractInfo,
  scanWitnessesTs,
  splitTopLevel,
  tsParams,
} from '../src/lib/contract-info.mjs';
import { cleanup, fixtureDir, tmpDir } from './helpers.mjs';

afterEach(cleanup);

describe('listCompiled / contractSources', () => {
  it('lists every compiled contract and every contract source', () => {
    const dir = fixtureDir('private-tip-jar');
    expect(listCompiled(dir)).toEqual(['private-tip-jar', 'tip-token']);
    expect(contractSources(dir).map((c) => c.name)).toEqual(['private-tip-jar', 'tip-token']);
  });

  it('skips module-only files and files another contract imports', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'contract'));
    const w = (f, s) => fs.writeFileSync(path.join(dir, 'contract', f), s);
    w('main.compact', 'pragma language_version 0.23;\nimport "lib";\n// include "commented-out"\n');
    w('lib.compact', 'export circuit f(): [] {}');
    w('schnorr.compact', '// a module\nmodule Schnorr {\n  export circuit g(): [] {}\n}\n');
    w('commented-out.compact', 'pragma language_version 0.23;');
    w('module-then-more.compact', 'module M {\n}\nexport circuit h(): [] {}\n');
    expect(contractSources(dir).map((c) => c.name)).toEqual(['commented-out', 'main', 'module-then-more']);
  });

  it('is empty without a contract dir', () => {
    expect(listCompiled(tmpDir())).toEqual([]);
    expect(contractSources(tmpDir())).toEqual([]);
  });
});

describe('readContractInfo', () => {
  it('keeps maxval exact beyond 2^53', () => {
    const info = readContractInfo(fixtureDir('private-tip-jar'), 'private-tip-jar');
    const coin = info.circuits.find((c) => c.name === 'tip').arguments[0].type;
    const value = coin.elements.find((e) => e.name === 'value').type;
    expect(value.maxval).toBe('340282366920938463463374607431768211455');
  });
});

describe('readConstructor', () => {
  it('reads a constructor without parameters', () => {
    expect(readConstructor(fixtureDir('hello-world'), 'hello-world')).toEqual({ hasArgs: false, params: '' });
  });

  it('reads a multi-line parameter list', () => {
    expect(readConstructor(fixtureDir('private-party'), 'private-party')).toEqual({
      hasArgs: true,
      params: 'partySize_0: bigint, fee_0: bigint, _secret_0: Uint8Array',
    });
  });

  it('keeps struct parameters, which index.d.ts writes inline, whole', () => {
    expect(tsParams(readConstructor(fixtureDir('struct-params'), 'struct-params').params)).toEqual([
      { name: 'cfg_0', tsType: 'Limits' },
      { name: 'w_0', tsType: '{ start: bigint, end: bigint }' },
      { name: 'coin_0', tsType: '{ nonce: Uint8Array, color: Uint8Array, value: bigint }' },
      { name: 'owner_0', tsType: 'Uint8Array' },
    ]);
  });

  it('returns null when the declaration is not where it expects', () => {
    const dir = fixtureDir('hello-world');
    const dts = path.join(dir, 'contract', 'managed', 'hello-world', 'contract', 'index.d.ts');
    fs.writeFileSync(dts, fs.readFileSync(dts, 'utf8').replace('initialState(context', 'init(context'));
    expect(readConstructor(dir, 'hello-world')).toBeNull();
  });
});

describe('compactConstructorParams', () => {
  it('splits only on top-level commas and ignores comments', () => {
    expect(
      compactConstructorParams('// constructor(nope: Field)\nconstructor(a: Vector<2, Bytes<32>>, b: Maybe<Uint<0..9>>) {}'),
    ).toEqual([
      { name: 'a', type: 'Vector<2, Bytes<32>>' },
      { name: 'b', type: 'Maybe<Uint<0..9>>' },
    ]);
  });

  it('agrees with the compiled arity for every fixture', () => {
    for (const [fixture, c] of [
      ['private-party', 'private-party'],
      ['silent-auction', 'silent-auction'],
      ['private-tip-jar', 'private-tip-jar'],
      ['struct-params', 'struct-params'],
    ]) {
      const dir = fixtureDir(fixture);
      const fromSource = compactConstructorParams(fs.readFileSync(path.join(dir, 'contract', `${c}.compact`), 'utf8'));
      expect(fromSource.length).toBe(tsParams(readConstructor(dir, c).params).length);
    }
  });

  it('is empty without a constructor', () => {
    expect(compactConstructorParams('export circuit f(): [] {}')).toEqual([]);
    expect(compactConstructorParams('constructor() {}')).toEqual([]);
  });
});

describe('splitTopLevel / tsParams', () => {
  it('splits only on commas outside brackets and braces', () => {
    expect(splitTopLevel('a_0: { x: bigint, y: { p: bigint, q: Uint8Array } }, b_0: Map<string, bigint>, c_0: [bigint, bigint]')).toEqual([
      'a_0: { x: bigint, y: { p: bigint, q: Uint8Array } }',
      'b_0: Map<string, bigint>',
      'c_0: [bigint, bigint]',
    ]);
  });

  it('is not unbalanced by an arrow', () => {
    expect(splitTopLevel('f: (x: bigint) => bigint, g: bigint')).toEqual(['f: (x: bigint) => bigint', 'g: bigint']);
  });

  it('splits each parameter at its first colon', () => {
    expect(tsParams('cfg: { a: bigint, b: bigint }, s?: Uint8Array, bare')).toEqual([
      { name: 'cfg', tsType: '{ a: bigint, b: bigint }' },
      { name: 's?', tsType: 'Uint8Array' },
      { name: 'bare', tsType: '' },
    ]);
    expect(tsParams('')).toEqual([]);
  });
});

describe('placeholderForCompactType', () => {
  it.each([
    ['Bytes<32>', 'new Uint8Array(32)'],
    ['Uint<16>', '0n'],
    ['Uint<0..255>', '0n'],
    ['Field', '0n'],
    ['Boolean', 'false'],
    ['Opaque<"string">', "''"],
    ['Vector<2, Boolean>', '[false, false]'],
    ['Vector<8, Field>', 'Array.from({ length: 8 }, () => 0n)'],
    ['UserAddress', '{ bytes: new Uint8Array(32) }'],
    ['ShieldedCoinInfo', '{ nonce: new Uint8Array(32), color: new Uint8Array(32), value: 0n }'],
    ['MyStruct', 'undefined as never'],
  ])('%s → %s', (type, want) => {
    expect(placeholderForCompactType(type)).toBe(want);
  });
});

describe('argTypeLiteral', () => {
  it('maps the tip jar arguments', () => {
    const info = readContractInfo(fixtureDir('private-tip-jar'), 'private-tip-jar');
    const arg = (circuit) => info.circuits.find((c) => c.name === circuit).arguments[0];
    expect(argTypeLiteral(arg('tip').type)).toBe('{ kind: "shieldedCoin" }');
    expect(argTypeLiteral(arg('ownerKey').type)).toBe('{ kind: "bytes", length: 32 }');
    expect(isSecretArg(arg('ownerKey'))).toBe(true);
  });
});

describe('scanWitnessesTs', () => {
  it('finds the private-state factory, its parameters and the witnesses export', () => {
    const party = scanWitnessesTs(fixtureDir('private-party'), 'private-party');
    expect(party).toMatchObject({
      factory: 'createPartyPrivateState',
      factoryParams: 'secret: Uint8Array',
      privateStateType: 'PartyPrivateState',
    });
    const tipJar = scanWitnessesTs(fixtureDir('private-tip-jar'), 'private-tip-jar');
    expect(tipJar).toMatchObject({
      factory: 'createPrivateTipJarPrivateState',
      privateStateType: 'PrivateTipJarPrivateState',
      perContract: 'privateTipJarWitnesses',
      witnessesExport: 'witnesses',
    });
  });

  it('is null without witnesses.ts', () => {
    expect(scanWitnessesTs(fixtureDir('hello-world'), 'hello-world')).toBeNull();
  });
});
