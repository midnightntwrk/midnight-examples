// Ed25519 fixtures. Each one is checked off-circuit with @noble/curves in
// fixtures.test.ts before any circuit sees it, so a transcription error shows
// up as a fixture failure, not as a false finding against the stdlib.
import { ed25519 } from '@noble/curves/ed25519.js';
import { hex } from '../encode.js';

export interface EdVector {
  name: string;
  source: string;
  publicKey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
}

// RFC 8032 section 7.1, TEST 1: the empty message (gap 01-G7: n = 0).
export const rfcTest1: EdVector = {
  name: 'RFC 8032 TEST 1 (empty message)',
  source: 'RFC 8032 §7.1',
  publicKey: hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
  message: new Uint8Array(0),
  signature: hex(
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  ),
};

// RFC 8032 TEST 2 (1-byte message), as vendor QA used it.
export const rfcTest2: EdVector = {
  name: 'RFC 8032 TEST 2 (1-byte message)',
  source: 'RFC 8032 §7.1; compact-end-2-end@672bc50 ed25519-verify.ts',
  publicKey: hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'),
  message: hex('72'),
  signature: hex(
    '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  ),
};

// RFC 8032 TEST SHA(abc): the 64-byte message is sha512("abc").
export const rfcTestShaAbc: EdVector = {
  name: 'RFC 8032 TEST SHA(abc) (64-byte message)',
  source: 'RFC 8032 §7.1; compact-end-2-end@672bc50 ed25519-verify.ts',
  publicKey: hex('ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf'),
  message: hex(
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  ),
  signature: hex(
    'dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704',
  ),
};

// A real Cardano mainnet payment: the vkey witness over the 32-byte tx id
// (block 13567385). Vendor QA's ed25519-cardano-signature case.
export const cardanoPayment: EdVector = {
  name: 'Cardano mainnet tx 411a7ba4… vkey witness',
  source: 'compact-end-2-end@672bc50 ed25519-cardano-signature.ts',
  publicKey: hex('e425fe0bd2c9f6f1205fac37ea3ddd03201fee1cc04ecf24aaa9a0585f7bf908'),
  message: hex('411a7ba46500984a9f039752991ce4467a64c790e76af0bb9edf64ed25f21911'),
  signature: hex(
    '52d63806e743366a436cc58fbd404465b7a6ea15632904a458385e9ce8114dc9c8982ada106a7df8705b153225da0d89d767997991885583a1c83d29ceb72f0e',
  ),
};
export const otherCardanoTxId = hex('dd25c5a801c4e855f021474e2c91242897812ded419c7a339114556ae4c11ed0');

// Deterministic test keys for vectors we sign ourselves. Ed25519 signing is
// deterministic, so these vectors are stable across runs.
export const testSecret = hex('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
export const otherSecret = hex('c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7');

export function signEd(secret: Uint8Array, message: Uint8Array): EdVector {
  return {
    name: `self-signed ${message.length}-byte message`,
    source: '@noble/curves ed25519 (deterministic)',
    publicKey: ed25519.getPublicKey(secret),
    message,
    signature: ed25519.sign(message, secret),
  };
}

// Gap 01-G7: a 1023-byte message (sha512 over many blocks in-circuit).
export const long1023 = signEd(
  testSecret,
  Uint8Array.from({ length: 1023 }, (_, i) => (i * 31 + 7) & 0xff),
);
