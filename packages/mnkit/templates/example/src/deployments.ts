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

// The deploy records `scripts/deploy.ts` writes, one file per network
// (deployments/<network>.json), and the types contract/deploy-args.ts uses to
// say what to deploy. Commit deployments/preview.json and preprod.json: they
// are how the team and later scripts find a contract (the UI's Join takes a
// pasted address). deployments/local.json is ignored, because the local devnet
// starts empty. Deploying a contract again keeps the old record under
// `previous`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { Contract as ContractTypes } from '@midnight-ntwrk/midnight-js-protocol/compact-js/effect/Contract';

/** The networks `mnkit deploy` targets. Mainnet is left out on purpose. */
export const DEPLOY_NETWORKS = ['local', 'preview', 'preprod'] as const;
export type DeployNetwork = (typeof DEPLOY_NETWORKS)[number];

/** One deployed contract, as deployments/<network>.json records it. */
export type DeploymentRecord = {
  address: string;
  txId: string;
  txHash: string;
  blockHeight: number;
  blockHash: string;
  /** The unshielded address of the wallet that paid for the deploy. */
  deployer: string;
  /** The private state's id in .mnkit/private-state/<network>, when it has one. */
  privateStateId?: string;
  deployedAt: string;
  /** Earlier deploys of this contract on this network, newest first. */
  previous?: Omit<DeploymentRecord, 'previous'>[];
};

export type DeploymentsFile = {
  network: string;
  networkId: string;
  /** By contract name (contract/<name>.compact). */
  contracts: Record<string, DeploymentRecord>;
};

/** What contract/deploy-args.ts sees when it builds a contract's arguments. */
export type DeployContext = {
  network: DeployNetwork;
  /** The contracts already deployed on this network, by name. */
  deployments: Record<string, DeploymentRecord>;
};

/** One contract `mnkit deploy` can deploy. */
export type Deployable<C extends ContractTypes.Any> = {
  compiledContract: CompiledContract.CompiledContract<C, any>;
  zkConfigPath: string;
  /** The constructor's arguments, in order. Omit it when the constructor takes none. */
  args?: (ctx: DeployContext) => ContractTypes.InitializeParameters<C>;
  /** Set both for a contract that keeps private state. */
  privateStateId?: string;
  initialPrivateState?: ContractTypes.PrivateState<C>;
};

/** Types one entry of `deployables` against its contract. */
export const deployable = <C extends ContractTypes.Any>(d: Deployable<C>): Deployable<C> => d;

const DEPLOYMENTS_DIR = fileURLToPath(new URL('../deployments/', import.meta.url));

export const deploymentsPath = (network: string): string => path.join(DEPLOYMENTS_DIR, `${network}.json`);

export function readDeployments(network: string): DeploymentsFile | null {
  const file = deploymentsPath(network);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as DeploymentsFile) : null;
}

/**
 * Records contract `name` in deployments/<network>.json and returns the file's
 * path. A record already there moves to the new one's `previous`. The contracts
 * in `stale` (deployed on a chain that no longer exists) are removed first,
 * history and all.
 */
export function writeDeployment(
  network: string,
  networkId: string,
  name: string,
  record: DeploymentRecord,
  stale: readonly string[] = [],
): string {
  const file = deploymentsPath(network);
  const contracts = { ...(readDeployments(network)?.contracts ?? {}) };
  for (const s of stale) delete contracts[s];
  const old = contracts[name];
  if (old) {
    const { previous = [], ...oldRecord } = old;
    contracts[name] = { ...record, previous: [oldRecord, ...previous] };
  } else {
    contracts[name] = record;
  }
  const next: DeploymentsFile = { network, networkId, contracts };
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}
