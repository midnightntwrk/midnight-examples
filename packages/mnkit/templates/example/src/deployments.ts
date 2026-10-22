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
// are how the team, the UI's Join and later scripts find a contract.
// deployments/local.json is ignored, because the local devnet starts empty.

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

/** Adds or replaces contract `name` in deployments/<network>.json and returns the file's path. */
export function writeDeployment(network: string, networkId: string, name: string, record: DeploymentRecord): string {
  const file = deploymentsPath(network);
  const current = readDeployments(network);
  const next: DeploymentsFile = {
    network,
    networkId,
    contracts: { ...(current?.contracts ?? {}), [name]: record },
  };
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}
