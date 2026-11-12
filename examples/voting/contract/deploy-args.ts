// This file is part of example-voting.
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
  CompiledVotingContract,
  type Contract,
  zkConfigPath,
  // @generated-stub begin deploy-imports sha=e3b0c44298fc
  // @generated-stub end deploy-imports
} from './index.js';
import { createVotingPrivateState } from './witnesses.js';
import { proposalIdFromLabel } from '../src/crypto.js';
import { readAdminKeys } from '../src/keys.js';

// The voting contract is deployed by its admin: the private state is the admin
// secret from .voting/admin.json (`npm run vote -- admin keygen`), and the
// proposal label comes from VOTING_PROPOSAL (for example MIP-0018).
// `npm run vote -- deploy --proposal MIP-0018` sets it and runs this deploy.
// Read lazily, so importing this file never needs the key file.
const proposal = (): Uint8Array => {
  const label = process.env['VOTING_PROPOSAL'];
  if (!label) throw new Error('Set VOTING_PROPOSAL (for example MIP-0018), or deploy with `npm run vote -- deploy`');
  return proposalIdFromLabel(label);
};

export const deployables: Record<string, Deployable<any>> = {
  'voting': deployable<Contract>({
    compiledContract: CompiledVotingContract,
    zkConfigPath,
    privateStateId: 'VotingState',
    // @generated-stub begin private-state sha=b3af2e592892
    get initialPrivateState() {
      return createVotingPrivateState(readAdminKeys().secretKey);
    },
    // @generated-stub end private-state
    args: (ctx: DeployContext) => [
      // @generated-stub begin constructor-args sha=c4045f9f5b3c
      proposal(),
      // @generated-stub end constructor-args
    ],
  }),
  // @generated-stub begin secondary-deploys sha=e3b0c44298fc
  // @generated-stub end secondary-deploys
};
