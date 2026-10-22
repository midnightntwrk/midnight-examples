// This file is part of example-private-tip-jar.
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

// The fixture's completed deploy-args.ts: tip-token is deployed first, and the
// jar only accepts tips in that token's color, which needs its address. The
// owner's secret key is fresh per deploy; `mnkit deploy` keeps it in the
// jar's private state (.mnkit/private-state/<network>).

import { randomBytes } from 'node:crypto';
import { tokenColor } from '@midnight-ntwrk/mnkit-coins';
import { deployable, type Deployable, type DeployContext } from '../src/deployments.js';
import {
  CompiledPrivateTipJarContract,
  type Contract,
  zkConfigPath,
  CompiledTipTokenContract,
  type TipTokenContract,
  tipTokenZkConfigPath,
} from './index.js';
import { createPrivateTipJarPrivateState } from './witnesses.js';

/** pad(32, "private-tip-jar:demo-token:") in tip-token.compact. */
const TOKEN_DOMAIN = 'private-tip-jar:demo-token:';

function tipTokenAddress(ctx: DeployContext): string {
  const token = ctx.deployments['tip-token'];
  if (!token) throw new Error(`Deploy tip-token on ${ctx.network} first: mnkit deploy tip-token`);
  return token.address;
}

export const deployables: Record<string, Deployable<any>> = {
  'private-tip-jar': deployable<Contract>({
    compiledContract: CompiledPrivateTipJarContract,
    zkConfigPath,
    privateStateId: 'PrivateTipJarState',
    initialPrivateState: createPrivateTipJarPrivateState(new Uint8Array(randomBytes(32))),
    args: (ctx: DeployContext) => [tokenColor(TOKEN_DOMAIN, tipTokenAddress(ctx)).bytes],
  }),
  'tip-token': deployable<TipTokenContract>({
    compiledContract: CompiledTipTokenContract,
    zkConfigPath: tipTokenZkConfigPath,
  }),
};
