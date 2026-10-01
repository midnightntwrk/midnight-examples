// SOW-Q3-01 at L2: signature_auth deployed on the local ledger 9 network and
// driven through Midnight.js 5 with real proofs (proof server 9.0.0-rc.8).
//
// Vendor QA proved verdict-storing circuits on chain. This proves the DApp
// shape: a signature AUTHORISING a state change exactly once, a private
// authorisation whose key never leaves the prover, and a passkey assertion
// whose challenge/origin/RP/UP are checked in-circuit. Refusals are checked
// too; they fail during local execution, before any proof is made.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { buildProviders, initNetwork, startWallet, uniqueStore, type Providers } from '@q3/harness';
import { CompiledSignatureAuth, ledger, signatureAuthManagedDir } from '../../contract/index.js';
import { pureCircuits as ed } from '../../contract/managed/ed25519_vectors/contract/index.js';
import { edPoint, edSignature, p256Point, p256Signature, toHex, utf8 } from '../encode.js';
import { testSecret } from '../fixtures/ed25519.js';
import { assert, challengeText, deviceKey, rpIdHash } from '../fixtures/p256.js';

const PRIVATE_STATE_ID = 'signatureAuthOwner';
const actionId = (label: string) => sha256(utf8(label));

describe('signature_auth on the local ledger 9 network', () => {
  let wallet: MidnightWalletProvider;
  let providers: Providers;
  let address: string;

  const call = (circuitId: string, ...args: unknown[]) =>
    submitCallTx(providers, {
      compiledContract: CompiledSignatureAuth,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
      circuitId,
      args,
    } as never);

  const read = async () => ledger((await providers.publicDataProvider.queryContractState(address))!.data);

  beforeAll(async () => {
    initNetwork();
    wallet = await startWallet('ALICE');
    providers = await buildProviders(wallet, { managedDir: signatureAuthManagedDir, storeName: uniqueStore('sigauth') });
    const signer = edPoint(ed25519.getPublicKey(testSecret));
    const deployed = await deployContract(providers, {
      compiledContract: CompiledSignatureAuth,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: { ownerSecretHex: toHex(testSecret) },
      args: [signer, ed.commit_key(signer), p256Point(deviceKey), rpIdHash, utf8(challengeText(0))],
    });
    address = deployed.deployTxData.public.contractAddress;
  });

  afterAll(async () => {
    await wallet?.stop();
  });

  it('AC-1 01-G10 authorize_once: an Ed25519 signature authorises an action on chain', async () => {
    const id = actionId('e2e withdraw 10');
    await call('authorize_once', id, edSignature(ed25519.sign(id, testSecret)));
    expect((await read()).used.member(id)).toBe(true);
  });

  it('AC-1 01-G10 authorize_once: the replay is refused', async () => {
    const id = actionId('e2e withdraw 10');
    await expect(call('authorize_once', id, edSignature(ed25519.sign(id, testSecret)))).rejects.toThrow(
      /action already authorised/,
    );
  });

  it('AC-1 01-G9 authorize_private: the committed owner authorises with key and signature as witnesses', async () => {
    await call('authorize_private', actionId('e2e vote yes'));
    expect((await read()).private_actions).toBe(1n);
  });

  it('AC-2 01-G5 passkey_action: a WebAuthn assertion with the stored challenge is accepted and rotates it', async () => {
    const a = assert(challengeText(0));
    await call('passkey_action', a.flagsHi, a.signCount, p256Signature(a.signature), utf8(challengeText(1)));
    const state = await read();
    expect(Buffer.from(state.challenge).toString()).toBe(challengeText(1));
    expect(state.passkey_actions).toBe(1n);
  });

  it('AC-2 01-G5 passkey_action: replaying that assertion is refused', async () => {
    const a = assert(challengeText(0));
    await expect(
      call('passkey_action', a.flagsHi, a.signCount, p256Signature(a.signature), utf8(challengeText(2))),
    ).rejects.toThrow(/passkey assertion does not verify/);
  });

  it('AC-2 01-G5 passkey_action: an assertion for another origin is refused', async () => {
    const a = assert(challengeText(1), { origin: 'https://q3.examp1e' });
    await expect(
      call('passkey_action', a.flagsHi, a.signCount, p256Signature(a.signature), utf8(challengeText(2))),
    ).rejects.toThrow(/passkey assertion does not verify/);
  });
});
