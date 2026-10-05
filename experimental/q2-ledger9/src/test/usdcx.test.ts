// This file is part of stagenet-q2 (adapted from example-usdcx/src/test/usdcx.test.ts).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// USDCx (bridged-usdc-mint) end-to-end: deploy with two attester addresses,
// mint via receiveAndMint from a third-party relayer, and reject an attestation
// replay. Witness closures read from a mutable attestation ref
// (src/witnesses/usdcx.ts). Compiles from source on rc.2 with --feature-zkir-v3
// (verifies ECDSA against supplied pubkeys — no recover-path primitives).

import { Buffer } from 'node:buffer';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';

import { config, logger, syncTimeoutMs } from '../test-support.js';
import { startFundedWallet } from '../harness.js';
import { stopWallet, type WalletCtx } from '../wallet.js';
import { createProviders, type Providers } from '../providers.js';
import { loadContract, type LoadedContract } from '../contracts.js';
import {
  BRIDGED_USDC_MINT_DIR,
  bridgedUsdcMintArtifactExists,
  buildUsdcxWitnesses,
  type AttestationRef,
} from '../witnesses/usdcx.js';
import {
  buildAttestation,
  generateAttesterKeypair,
  nonceFromCounter,
  SOURCE_DOMAIN_ETHEREUM,
  toHex,
  type AttesterKeypair,
  type AssembledAttestation,
} from '../attestation-fixture.js';

const PRIVATE_STATE_ID = 'usdcx-bridge';
const TEST_NONCE_COUNTER = 1n;
const TEST_AMOUNT = 1_000_000n; // 1 USDC (6 decimals)
const TEST_DESTINATION_DOMAIN = 999; // arbitrary — contract ignores it

const artifactPresent = bridgedUsdcMintArtifactExists();
if (!artifactPresent) {
  console.log(
    '\n=== GAP === usdcx: BridgedUsdcMint not compiled. Build with' +
      "\n            `yarn compile` (usdcx needs --feature-zkir-v3, wired in" +
      '\n            scripts/compile.mts).\n',
  );
}

describe.skipIf(!artifactPresent)(`usdcx bridge (${config.networkId})`, () => {
  let deployer: WalletCtx;
  let relayer: WalletCtx;
  let deployerProviders: Providers;
  let relayerProviders: Providers;
  let loaded: LoadedContract;
  const attestationRef: AttestationRef = { current: null };

  let attesterA: AttesterKeypair;
  let attesterB: AttesterKeypair;
  let contractAddress: string;
  let attestation: AssembledAttestation;

  beforeAll(async () => {
    loaded = await loadContract(
      'BridgedUsdcMint',
      BRIDGED_USDC_MINT_DIR,
      buildUsdcxWitnesses(attestationRef),
    );
    logger.info(`loaded compiled artifact at ${loaded.zkConfigPath}`);

    // Ephemeral attester keypairs stand in for Circle's mainnet attesters; the
    // contract only checks membership + strict ascending order, and the private
    // keys never appear on-chain, so test keys are verification-equivalent.
    attesterA = generateAttesterKeypair();
    attesterB = generateAttesterKeypair();
    logger.info(`attesters: A=${toHex(attesterA.ethAddress)} B=${toHex(attesterB.ethAddress)}`);

    [deployer, relayer] = await Promise.all([
      startFundedWallet('deployer', 0, config, logger, syncTimeoutMs),
      startFundedWallet('relayer', 1, config, logger, syncTimeoutMs),
    ]);

    [deployerProviders, relayerProviders] = await Promise.all([
      createProviders(deployer, loaded.zkConfigPath, PRIVATE_STATE_ID, config),
      createProviders(relayer, loaded.zkConfigPath, PRIVATE_STATE_ID, config),
    ]);
    logger.info('providers ready');
  });

  afterAll(async () => {
    await Promise.allSettled([
      deployer ? stopWallet(deployer, logger) : Promise.resolve(),
      relayer ? stopWallet(relayer, logger) : Promise.resolve(),
    ]);
  });

  it('deploys BridgedUsdcMint with two attester addresses', async () => {
    const deploy = deployContract as unknown as (
      p: Providers,
      opts: Record<string, unknown>,
    ) => Promise<{ deployTxData: { public: { contractAddress: string; txId: string } } }>;
    // Attesters registered by the x-coordinate of their secp256k1 pubkey,
    // positionally. Compact's `Secp256k1Base as Bytes<32>` is little-endian
    // while the uncompressed pubkey stores x big-endian — reverse the 32-byte x.
    const xCoordLE = (pubkey: Uint8Array) => pubkey.slice(0, 32).reverse();
    const deployed = await deploy(deployerProviders, {
      compiledContract: loaded.compiledContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
      args: [xCoordLE(attesterA.publicKey), xCoordLE(attesterB.publicKey)],
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`deployed at ${contractAddress} (tx=${deployed.deployTxData.public.txId})`);
    expect(contractAddress).toMatch(/^[0-9a-fA-F]+$/);

    const state = await queryLedger(deployerProviders, contractAddress);
    expect(Number(state.totalMinted)).toBe(0);
  });

  it('mints via receiveAndMint from the relayer wallet', async () => {
    // Recipient identity derived from the deployer's shielded coin public key.
    const mintRecipient = new Uint8Array(32);
    const shieldedPk = Buffer.from(
      deployer.shieldedSecretKeys.coinPublicKey.replace(/^0x/, ''),
      'hex',
    );
    shieldedPk.copy(mintRecipient, 0, 0, Math.min(32, shieldedPk.length));

    const nonce = nonceFromCounter(TEST_NONCE_COUNTER);
    attestation = buildAttestation({
      fields: {
        sourceDomain: SOURCE_DOMAIN_ETHEREUM,
        destinationDomain: TEST_DESTINATION_DOMAIN,
        nonce,
        amount: TEST_AMOUNT,
        mintRecipient,
      },
      attesterA,
      attesterB,
    });
    attestationRef.current = attestation;

    // The relayer deployed nothing; seed its private-state store (scoped by
    // address). This contract keeps no meaningful private state.
    relayerProviders.privateStateProvider.setContractAddress(contractAddress);
    await relayerProviders.privateStateProvider.set(PRIVATE_STATE_ID, {});

    const submit = submitCallTx as unknown as (p: Providers, o: Record<string, unknown>) => Promise<unknown>;
    await submit(relayerProviders, {
      compiledContract: loaded.compiledContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'receiveAndMint',
      args: [],
    });

    const state = await queryLedger(relayerProviders, contractAddress);
    expect(BigInt(state.totalMinted)).toBe(TEST_AMOUNT);
    expect(BigInt(state.mintEvents.lookup(attestation.nonceKey))).toBe(TEST_AMOUNT);
    expect(state.usedNonces.member(attestation.nonceKey)).toBe(true);
  });

  it('rejects replay of the identical attestation', async () => {
    attestationRef.current = attestation;
    const submit = submitCallTx as unknown as (p: Providers, o: Record<string, unknown>) => Promise<unknown>;
    await expect(
      submit(relayerProviders, {
        compiledContract: loaded.compiledContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'receiveAndMint',
        args: [],
      }),
    ).rejects.toThrow(/nonce already used/);

    const state = await queryLedger(relayerProviders, contractAddress);
    expect(BigInt(state.totalMinted)).toBe(TEST_AMOUNT);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function queryLedger(providers: Providers, address: string): Promise<any> {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error(`no contract state at ${address}`);
    return loaded.module.ledger(state.data);
  }
});
