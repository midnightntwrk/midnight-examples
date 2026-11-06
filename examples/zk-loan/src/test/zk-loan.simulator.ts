// This file is part of example-zk-loan.
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

// In-memory simulator: runs the compiled circuits directly (no network, no
// proofs) so contract logic can be unit-tested in milliseconds. Ported from
// midnightntwrk/example-zkloan (contract/src/test/zkloan-credit-scorer.simulator.ts).

//
// From compact-runtime 0.20 (Compact 0.35) the constructor and circuits are
// async and createCircuitContext takes one options object. So the simulator is
// built with `await ZkLoanSimulator.create()`, every circuit method is async,
// and each call gets a fresh context built from the current public state,
// private state and zswap local state.

import {
  type ChargedState,
  type CircuitContext,
  type CircuitResults,
  type EncodedZswapLocalState,
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
  type JubjubPoint,
  transientHash,
  CompactTypeBytes,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Contract, type Ledger, ledger, pureCircuits } from '../../contract/managed/zk-loan/contract/index.js';
import { type ZkLoanPrivateState, witnesses } from '../../contract/witnesses.js';
import { createEitherTestUser } from './utils/address.js';
import { createSignedUserProfile, generateUserSecret, generateProviderKeyPair } from './utils/test-data.js';

const bytes32Type = new CompactTypeBytes(32);

type Circuit = (context: CircuitContext<ZkLoanPrivateState>) => Promise<CircuitResults<ZkLoanPrivateState, unknown>>;

export class ZkLoanSimulator {
  readonly contract: Contract<ZkLoanPrivateState>;
  readonly address = sampleContractAddress();
  /** The contract's public state; `getLedger()` decodes it. */
  state!: ChargedState;
  /** The private state the next call's witnesses see. Assign to swap it. */
  privateState!: ZkLoanPrivateState;
  private zswapLocalState!: EncodedZswapLocalState;
  private readonly deployerCoinPublicKey: string;
  private readonly initialPrivateState: ZkLoanPrivateState;
  readonly providerSk: bigint;
  readonly providerPk: JubjubPoint;
  readonly providerId: bigint = 1n;
  readonly userSecretKey: Uint8Array;

  // `witnessOverrides` lets a test swap in a malicious witness implementation
  // (e.g. a forged Schnorr challenge reduction) while keeping the rest honest.
  private constructor(witnessOverrides: Partial<typeof witnesses>) {
    const user = createEitherTestUser('Alice');
    this.deployerCoinPublicKey = user.left.hex;
    this.contract = new Contract<ZkLoanPrivateState>({ ...witnesses, ...witnessOverrides });

    // Generate provider key pair
    const keyPair = generateProviderKeyPair();
    this.providerSk = keyPair.sk;
    this.providerPk = keyPair.pk;

    // The single per-instance user secret. The deployer's
    // `deriveAdminPublicKey(userSecret)` gets pinned into `contractAdmin` at
    // construction, so the deployer is admin. The same secret derives the
    // deployer's per-user identity (PIN-bound) via `deriveUserPublicKey`.
    this.userSecretKey = generateUserSecret();

    // Initial private state. `userPubKeyHash` for the attestation message is
    // now derived from the witness secret, not from `ownPublicKey()`.
    const userPubKeyHash = this.computeUserPubKeyHash(this.userSecretKey, 1234n);
    this.initialPrivateState = createSignedUserProfile(
      0,
      this.providerSk,
      userPubKeyHash,
      this.providerId,
      this.userSecretKey,
    );
  }

  /** Deploys the contract in memory and registers the default provider. */
  static async create(witnessOverrides: Partial<typeof witnesses> = {}): Promise<ZkLoanSimulator> {
    const sim = new ZkLoanSimulator(witnessOverrides);
    const { currentPrivateState, currentContractState, currentZswapLocalState } = await sim.contract.initialState(
      createConstructorContext(sim.initialPrivateState, sim.deployerCoinPublicKey),
    );
    sim.state = currentContractState.data;
    sim.privateState = currentPrivateState;
    sim.zswapLocalState = currentZswapLocalState;

    // Register the default provider
    await sim.registerProvider(sim.providerId, sim.providerPk);
    return sim;
  }

  /**
   * Runs one circuit as its own transaction. On success the public, private
   * and zswap state move forward; if it throws (a failed assert), none change.
   */
  private async run(circuitId: string, circuit: Circuit): Promise<Ledger> {
    const context = createCircuitContext<ZkLoanPrivateState>({
      circuitId,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: this.zswapLocalState,
      contractState: this.state,
      privateState: this.privateState,
    });
    const { context: after } = await circuit(context);
    this.state = after.callContext.currentQueryContext.state;
    this.privateState = after.callContext.currentPrivateState as ZkLoanPrivateState;
    this.zswapLocalState = after.callContext.currentZswapLocalState ?? this.zswapLocalState;
    return ledger(this.state);
  }

  // Off-chain derivation of the per-user public key (PIN-bound). Uses the
  // same pure circuit the contract uses, so the bytes match exactly.
  public deriveUserPublicKey(userSecret: Uint8Array, pin: bigint): Uint8Array {
    return pureCircuits.deriveUserPublicKey(userSecret, pin);
  }

  public deriveAdminPublicKey(userSecret: Uint8Array): Uint8Array {
    return pureCircuits.deriveAdminPublicKey(userSecret);
  }

  public generateUserSecret(): Uint8Array {
    return generateUserSecret();
  }

  // The attestation message binds to the derived user pubkey via
  // transientHash, exactly as the contract does in `requestLoan`.
  public computeUserPubKeyHash(userSecret: Uint8Array, pin: bigint): bigint {
    const pubKey = this.deriveUserPublicKey(userSecret, pin);
    return transientHash(bytes32Type, pubKey);
  }

  // Swap the simulator's local user secret. Tests use this to act as a
  // non-admin caller (after rotating admin to someone else's pubkey) or to
  // simulate a different user impersonating from the same browser instance.
  public setUserSecret(secret: Uint8Array): void {
    this.privateState = { ...this.privateState, userSecretKey: secret };
  }

  public getLedger(): Ledger {
    return ledger(this.state);
  }

  public getPrivateState(): ZkLoanPrivateState {
    return this.privateState;
  }

  public requestLoan(amountRequested: bigint, secretPin: bigint): Promise<Ledger> {
    return this.run('requestLoan', (ctx) => this.contract.impureCircuits.requestLoan(ctx, amountRequested, secretPin));
  }

  public blacklistUser(userPubKey: Uint8Array): Promise<Ledger> {
    return this.run('blacklistUser', (ctx) => this.contract.impureCircuits.blacklistUser(ctx, userPubKey));
  }

  public removeBlacklistUser(userPubKey: Uint8Array): Promise<Ledger> {
    return this.run('removeBlacklistUser', (ctx) => this.contract.impureCircuits.removeBlacklistUser(ctx, userPubKey));
  }

  public changePin(oldPin: bigint, newPin: bigint): Promise<Ledger> {
    return this.run('changePin', (ctx) => this.contract.impureCircuits.changePin(ctx, oldPin, newPin));
  }

  public respondToLoan(loanId: bigint, secretPin: bigint, accept: boolean): Promise<Ledger> {
    return this.run('respondToLoan', (ctx) => this.contract.impureCircuits.respondToLoan(ctx, loanId, secretPin, accept));
  }

  public rotateAdmin(newAdminPublicKey: Uint8Array): Promise<Ledger> {
    return this.run('rotateAdmin', (ctx) => this.contract.impureCircuits.rotateAdmin(ctx, newAdminPublicKey));
  }

  public registerProvider(providerId: bigint, providerPk: JubjubPoint): Promise<Ledger> {
    return this.run('registerProvider', (ctx) => this.contract.impureCircuits.registerProvider(ctx, providerId, providerPk));
  }

  public removeProvider(providerId: bigint): Promise<Ledger> {
    return this.run('removeProvider', (ctx) => this.contract.impureCircuits.removeProvider(ctx, providerId));
  }

  public createTestUser(str: string): any {
    return createEitherTestUser(str);
  }
}
