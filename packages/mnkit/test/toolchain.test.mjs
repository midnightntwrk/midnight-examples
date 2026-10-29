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

import { describe, expect, it } from 'vitest';
import { pinFor } from '../src/lib/toolchain.mjs';

const tc = {
  npm: {
    'midnight-js': '4.1.1',
    'testkit-js': '4.1.1',
    'wallet-sdk': '1.2.0',
    'wallet-sdk-address-format': '3.1.2',
    'dapp-connector-api': '4.0.1',
    vitest: '5.0.4',
    vite: '6.4.4',
  },
  overrides: { '@midnight-ntwrk/ledger-v8': '8.1.2', 'vite-plugin-top-level-await/uuid': '11.1.1' },
};

describe('pinFor', () => {
  it('pins the families and single packages toolchain.json names', () => {
    expect(pinFor(tc, '@midnight-ntwrk/midnight-js-contracts')).toBe('4.1.1');
    expect(pinFor(tc, '@midnight-ntwrk/wallet-sdk')).toBe('1.2.0');
    expect(pinFor(tc, 'vitest')).toBe('^5.0.4');
    expect(pinFor(tc, 'react')).toBeNull();
  });

  it('pins a wallet-sdk-* package only when npm names it', () => {
    expect(pinFor(tc, '@midnight-ntwrk/wallet-sdk-address-format')).toBe('3.1.2');
    expect(pinFor(tc, '@midnight-ntwrk/wallet-sdk-facade')).toBeNull();
  });

  it('pins a Midnight package in overrides, but not a nested override', () => {
    expect(pinFor(tc, '@midnight-ntwrk/ledger-v8')).toBe('8.1.2');
    expect(pinFor(tc, 'vite-plugin-top-level-await/uuid')).toBeNull();
  });

  it('turns an exact pin into a tilde range in peerDependencies', () => {
    expect(pinFor(tc, '@midnight-ntwrk/wallet-sdk-address-format', { peer: true })).toBe('~3.1.2');
    expect(pinFor(tc, 'vitest', { peer: true })).toBe('^5.0.4');
  });
});
