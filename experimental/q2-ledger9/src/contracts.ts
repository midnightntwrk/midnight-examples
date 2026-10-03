// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// The compiled-contract seam: load a compactc-emitted module, bind it into a
// midnight-js CompiledContract (with or without witnesses), and deploy / call /
// read it. Ported from compact-end-2-end/utils (compiled.ts + contract-ops.ts),
// consuming this repo's example-usdcx-style Providers.

import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';

import type { Providers } from './providers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Witnesses = Record<string, (...args: any[]) => unknown>;

export interface CompiledModule {
  Contract: new (...args: never[]) => unknown;
  ledger: (data: unknown) => unknown;
}

export interface LoadedContract {
  zkConfigPath: string;
  module: CompiledModule;
  compiledContract: unknown;
}

/* ── hex helpers ──────────────────────────────────────────────────────────── */

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function hexToBytes32(hex: string): Uint8Array {
  const buf = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const out = new Uint8Array(32);
  out.set(buf.subarray(0, Math.min(32, buf.length)));
  return out;
}

export function contractAddressBytes(contractAddress: string): Uint8Array {
  const buf = Buffer.from(contractAddress.replace(/^0x/, ''), 'hex');
  if (buf.length !== 32) {
    throw new Error(`contract address must be 32 bytes, got ${buf.length}: ${contractAddress}`);
  }
  return new Uint8Array(buf);
}

/* ── load + bind ──────────────────────────────────────────────────────────── */

/** True if `yarn compile` has emitted this contract's TS bindings. */
export function artifactExists(managedDir: string): boolean {
  return fs.existsSync(path.join(managedDir, 'contract', 'index.js'));
}

/**
 * Load a compactc-compiled contract's bindings and bind them into a midnight-js
 * CompiledContract. Pass `witnesses` for a witnessed contract; omit for a
 * witness-free contract (bound with vacant witnesses). Throws if not compiled.
 */
export async function loadContract(
  tag: string,
  managedDir: string,
  witnesses?: Witnesses,
): Promise<LoadedContract> {
  const indexPath = path.join(managedDir, 'contract', 'index.js');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`compiled contract not found: ${indexPath}. Run \`yarn compile\` first.`);
  }
  const imported: unknown = await import(pathToFileURL(indexPath).href);
  const module = assertCompiledModule(indexPath, imported);

  // SDK seam: make()/withWitnesses/withCompiledFileAssets are generic over
  // Contract<C>, which a dynamically-imported module can't supply statically.
  const make = CompiledContract.make as unknown as (
    tag: string,
    ctor: unknown,
  ) => { pipe: (...fs: unknown[]) => unknown };
  const withAssets = CompiledContract.withCompiledFileAssets as unknown as (p: string) => unknown;
  const withW = witnesses
    ? (CompiledContract.withWitnesses as unknown as (w: unknown) => unknown)(witnesses)
    : CompiledContract.withVacantWitnesses;

  const compiledContract = make(tag, module.Contract).pipe(withW, withAssets(managedDir));
  return { zkConfigPath: managedDir, module, compiledContract };
}

/* ── deploy / call / read ─────────────────────────────────────────────────── */

interface TreeCall {
  contractAddress: string;
  public: { contractState: unknown };
}
interface CallTxData {
  public: {
    txId: string;
    txHash: string;
    status: unknown;
    nextContractState: unknown;
  };
  private: { result: unknown };
  calls?: readonly TreeCall[];
}
type CircuitFn = (...args: unknown[]) => Promise<CallTxData>;

export interface DeployedContractLike {
  deployTxData: { public: { contractAddress: string; txId: string } };
  callTx: Record<string, CircuitFn>;
}

export interface DeployResult {
  contractAddress: string;
  txId: string;
  deployed: DeployedContractLike;
}

export interface CallResult {
  txId: string;
  txHash: string;
  result: unknown;
  status: unknown;
  nextContractState: unknown;
  calls?: readonly TreeCall[] | undefined;
}

/** Deploy a fresh instance with constructor args and an empty private state. */
export async function deployFresh(
  providers: Providers,
  compiledContract: unknown,
  privateStateId: string,
  args: readonly unknown[],
): Promise<DeployResult> {
  const deploy = deployContract as unknown as (
    p: Providers,
    opts: unknown,
  ) => Promise<DeployedContractLike>;
  try {
    const deployed = await deploy(providers, {
      compiledContract,
      privateStateId,
      initialPrivateState: {},
      args,
    });
    const pub = deployed.deployTxData.public;
    return { contractAddress: pub.contractAddress, txId: pub.txId, deployed };
  } catch (e) {
    throw new Error(`deploy(${privateStateId}) failed: ${causeChain(e)}`, { cause: e });
  }
}

/** Submit a call to `circuitId` on a contract handle deployed in this process. */
export async function callCircuit(
  deployed: DeployedContractLike,
  circuitId: string,
  args: readonly unknown[],
): Promise<CallResult> {
  const fn = deployed.callTx[circuitId];
  if (!fn) throw new Error(`callTx.${circuitId} not exposed by deployed contract`);
  const res = await fn(...args);
  return {
    txId: res.public.txId,
    txHash: res.public.txHash,
    result: res.private.result,
    status: res.public.status,
    nextContractState: res.public.nextContractState,
    calls: res.calls,
  };
}

/**
 * Submit a call from a wallet that did NOT deploy the contract (e.g. a relayer),
 * by contract address. Seed the caller's private-state store first when the
 * contract keeps no meaningful private state.
 */
export async function submitCall(
  providers: Providers,
  opts: {
    compiledContract: unknown;
    contractAddress: string;
    privateStateId: string;
    circuitId: string;
    args: readonly unknown[];
  },
): Promise<void> {
  const submit = submitCallTx as unknown as (p: Providers, o: unknown) => Promise<unknown>;
  await submit(providers, opts);
}

/** Indexer-read the contract state, projected through the bindings' ledger() view. */
export async function readLedger<L>(
  providers: Providers,
  contractAddress: string,
  module: CompiledModule,
): Promise<L> {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error(`no contract state at ${contractAddress}`);
  return module.ledger(state.data) as L;
}

/** Project an in-hand contract state (e.g. a call's nextContractState) — no indexer. */
export function decodeLedger<L>(module: CompiledModule, state: unknown): L {
  return module.ledger(state) as L;
}

/* ── internals ────────────────────────────────────────────────────────────── */

function assertCompiledModule(indexPath: string, module: unknown): CompiledModule {
  if (typeof module !== 'object' || module === null) {
    throw new Error(`compiled module is not an object: ${indexPath}`);
  }
  const mod = module as { Contract?: unknown; ledger?: unknown };
  if (typeof mod.Contract !== 'function') {
    throw new Error(`compiled module missing callable Contract export: ${indexPath}`);
  }
  if (typeof mod.ledger !== 'function') {
    throw new Error(`compiled module missing callable ledger() export: ${indexPath}`);
  }
  return module as CompiledModule;
}

function causeChain(e: unknown): string {
  const chain: string[] = [];
  let cur: unknown = e;
  while (cur && typeof cur === 'object' && 'message' in cur) {
    chain.push(String((cur as { message: unknown }).message));
    cur = (cur as { cause?: unknown }).cause;
  }
  return chain.join(' <- ');
}
