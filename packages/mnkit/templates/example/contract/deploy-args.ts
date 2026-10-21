// This file is part of example-__name__.
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

// What `mnkit deploy` deploys: each contract's constructor arguments and
// initial private state. This file is yours. `mnkit derive` fills the
// @generated-stub regions from the compiled contract until you edit them.
//
// `ctx.deployments` holds the contracts already deployed on the network, so a
// constructor that takes another contract's address (or its token color) can
// read it there. Deploy that contract first: `mnkit deploy <name>`.

import { deployable, type Deployable, type DeployContext } from '../src/deployments.js';
import {
  Compiled__Name__Contract,
  type Contract,
  zkConfigPath,
  // @generated-stub begin deploy-imports sha=0
  // @generated-stub end deploy-imports
} from './index.js';
__DEPLOY_PS_IMPORT__

export const deployables: Record<string, Deployable<any>> = {
  '__name__': deployable<Contract>({
    compiledContract: Compiled__Name__Contract,
    zkConfigPath,
    privateStateId: '__Name__State',
    // @generated-stub begin private-state sha=0
    initialPrivateState: __INITIAL_PRIVATE_STATE__,
    // @generated-stub end private-state
    args: (ctx: DeployContext) => [
      // @generated-stub begin constructor-args sha=0
      // @generated-stub end constructor-args
    ],
  }),
  // @generated-stub begin secondary-deploys sha=0
  // @generated-stub end secondary-deploys
};
