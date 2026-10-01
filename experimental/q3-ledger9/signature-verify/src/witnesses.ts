// Witnesses for signature_auth.compact's authorize_private.
//
// They run on the prover's machine. Their outputs are private inputs to the
// proof and never appear in the transaction. The private state is kept as hex,
// not Uint8Array: Midnight.js 5's level private-state store serialises with
// superjson and refuses types it cannot round-trip
// (PrivateStateSerializationError).
import { ed25519 } from '@noble/curves/ed25519.js';
import { edPoint, edSignature, hex } from './encode.js';

export type SignatureAuthPrivateState = { ownerSecretHex: string };

type Ctx = { privateState: SignatureAuthPrivateState };

export const witnesses = {
  owner_key: ({ privateState }: Ctx) =>
    [privateState, edPoint(ed25519.getPublicKey(hex(privateState.ownerSecretHex)))] as [SignatureAuthPrivateState, ReturnType<typeof edPoint>],
  owner_signature: ({ privateState }: Ctx, msg: Uint8Array) =>
    [privateState, edSignature(ed25519.sign(msg, hex(privateState.ownerSecretHex)))] as [SignatureAuthPrivateState, ReturnType<typeof edSignature>],
};
