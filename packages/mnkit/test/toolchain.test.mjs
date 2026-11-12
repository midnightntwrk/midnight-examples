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
    'midnight-js': '5.0.0',
    'midnight-js-network-id': '5.0.0-rc.5',
    'testkit-js': '5.0.0',
    'wallet-sdk': '2.0.0',
    'wallet-sdk-address-format': '4.0.0',
    'dapp-connector-api': '4.0.1',
    vitest: '5.0.4',
    vite: '6.4.4',
  },
  overrides: { '@midnightntwrk/ledger-v9': '1.0.0', 'vite-plugin-top-level-await/uuid': '11.1.1' },
};

describe('pinFor', () => {
  it('pins the families and single packages toolchain.json names', () => {
    expect(pinFor(tc, '@midnight-ntwrk/midnight-js-contracts')).toBe('5.0.0');
    expect(pinFor(tc, '@midnightntwrk/wallet-sdk')).toBe('2.0.0');
    expect(pinFor(tc, '@midnight-ntwrk/testkit-js')).toBe('5.0.0');
    expect(pinFor(tc, 'vitest')).toBe('^5.0.4');
    expect(pinFor(tc, 'react')).toBeNull();
  });

  it('gives midnight-js-network-id its own pin, falling back to the family', () => {
    expect(pinFor(tc, '@midnight-ntwrk/midnight-js-network-id')).toBe('5.0.0-rc.5');
    const { 'midnight-js-network-id': _, ...npm } = tc.npm;
    expect(pinFor({ ...tc, npm }, '@midnight-ntwrk/midnight-js-network-id')).toBe('5.0.0');
  });

  it('pins the wallet SDK on @midnightntwrk only', () => {
    expect(pinFor(tc, '@midnight-ntwrk/wallet-sdk')).toBeNull();
  });

  it('pins a wallet-sdk-* package only when npm names it', () => {
    expect(pinFor(tc, '@midnightntwrk/wallet-sdk-address-format')).toBe('4.0.0');
    expect(pinFor(tc, '@midnightntwrk/wallet-sdk-facade')).toBeNull();
  });

  it('pins a Midnight package in overrides, but not a nested override', () => {
    expect(pinFor(tc, '@midnightntwrk/ledger-v9')).toBe('1.0.0');
    expect(pinFor(tc, 'vite-plugin-top-level-await/uuid')).toBeNull();
  });

  it('turns an exact pin into a tilde range in peerDependencies', () => {
    expect(pinFor(tc, '@midnightntwrk/wallet-sdk-address-format', { peer: true })).toBe('~4.0.0');
    expect(pinFor(tc, 'vitest', { peer: true })).toBe('^5.0.4');
  });
});
