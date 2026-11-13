// The two private-state stores a generated UI can use. contract.ts's
// PRIVATE_STATE_STORAGE (set by `npm run new:ui`'s --private-state flag) picks one:
//
//   "memory"      inMemoryPrivateStateProvider: plain Maps, lost on reload.
//                 Fine when private state is re-derivable or throwaway.
//   "persistent"  persistentPrivateStateProvider: midnight-js's own
//                 levelPrivateStateProvider on IndexedDB, AES-GCM encrypted
//                 under a passphrase the user types each session. Needed
//                 when losing private state locks the user out (a secret key
//                 that is their on-chain identity, a commitment's randomness).
import type { ContractPrivateStates, PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { assertIsContractAddress } from "@midnight-ntwrk/midnight-js-utils";

export type PrivateStateStorage = "memory" | "persistent";

/** The IndexedDB database the persistent store lives in (one per UI). */
export const PERSISTENT_DB_NAME = "token-transfers-ui-private-state";

/**
 * levelPrivateStateProvider scopes private state by contract address, and
 * never checks the password until it decrypts a value. We store one canary
 * under a reserved address so a wrong passphrase is reported at unlock time,
 * not later as an opaque decrypt failure in the middle of a tx. The address
 * must be 32 bytes of hex; a deployed contract's address is a hash, so none
 * is all zeros.
 */
const CANARY_ADDRESS = "00".repeat(32);
const CANARY_ID = "canary";

export class WrongPassphraseError extends Error {
  constructor(cause: unknown) {
    super(
      "That passphrase doesn't open this browser's private state for this wallet account. " +
        "Use the passphrase you chose the first time.",
      { cause },
    );
    this.name = "WrongPassphraseError";
  }
}

/**
 * Encrypted IndexedDB private state, via @midnight-ntwrk/midnight-js-level-private-state-provider
 * (the same provider the Node harness uses; `level` resolves to `browser-level`
 * in the browser build).
 *
 * - `accountId` scopes the store (the provider hashes it), so two wallet
 *   accounts in one browser never see each other's state. Use the wallet's
 *   shielded coin public key.
 * - `passphrase` must pass midnight-js-utils' `validatePassword` (16+ chars,
 *   3 character classes, no runs/sequences). It is only ever held in memory.
 * - There is no recovery: clearing site data or forgetting the passphrase
 *   loses the private state for good (the provider's own warning).
 *
 * Imported lazily, so UIs that use "memory" don't bundle `level`.
 */
export async function persistentPrivateStateProvider<PSI extends string, PS>(options: {
  accountId: string;
  passphrase: string;
}): Promise<PrivateStateProvider<PSI, PS>> {
  const { levelPrivateStateProvider } = await import(
    "@midnight-ntwrk/midnight-js-level-private-state-provider"
  );
  const provider = levelPrivateStateProvider<PSI, PS>({
    midnightDbName: PERSISTENT_DB_NAME,
    accountId: options.accountId,
    privateStoragePasswordProvider: () => options.passphrase,
    cryptoBackend: "webcrypto",
  });

  // Validate the passphrase against the store before handing it out. The
  // canary lives under its own pseudo-address, so no contract's state sees it.
  const canary = (provider as unknown as PrivateStateProvider<string, { ok: true }>).forContract(
    CANARY_ADDRESS,
  );
  let existing: { ok: true } | null;
  try {
    existing = await canary.get(CANARY_ID);
  } catch (err: unknown) {
    throw new WrongPassphraseError(err);
  }
  if (existing === null) await canary.set(CANARY_ID, { ok: true });
  return provider;
}

/**
 * Session-scoped, in-memory implementation of the full PrivateStateProvider
 * interface: private state (per contract address) and signing keys live in
 * plain Maps for the lifetime of the page.
 *
 * The export/import methods are not meaningful for an ephemeral in-memory
 * store, so they reject. Use persistentPrivateStateProvider (`npm run new:ui` with
 * --private-state persistent) for cross-session private state.
 */
export function inMemoryPrivateStateProvider<
  PSI extends string,
  PS,
>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  const unsupported = (method: string) => async (): Promise<never> => {
    throw new Error(
      `inMemoryPrivateStateProvider does not support ${method}; ` +
        "use a persistent encrypting provider for exports and imports.",
    );
  };

  const forContract = (address: ContractAddress): ContractPrivateStates<PSI, PS> => {
    // The same checks the persistent store makes: 32 bytes of hex, compared
    // in lower case.
    assertIsContractAddress(address);
    const contractAddress = address.toLowerCase();
    const scoped = (): Map<PSI, PS> => {
      let m = states.get(contractAddress);
      if (m === undefined) states.set(contractAddress, (m = new Map()));
      return m;
    };
    return {
      contractAddress,
      set: async (id: PSI, state: PS) => {
        scoped().set(id, state);
      },
      get: async (id: PSI) => states.get(contractAddress)?.get(id) ?? null,
      remove: async (id: PSI) => {
        states.get(contractAddress)?.delete(id);
      },
      clear: async () => {
        states.delete(contractAddress);
      },
      exportPrivateStates: unsupported("exportPrivateStates"),
      importPrivateStates: unsupported("importPrivateStates"),
    };
  };

  return {
    forContract,
    // Private states only; signing keys have clearSigningKeys.
    clearAll: async () => {
      states.clear();
    },
    setSigningKey: async (address: ContractAddress, signingKey: SigningKey) => {
      signingKeys.set(address, signingKey);
    },
    getSigningKey: async (address: ContractAddress) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address: ContractAddress) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },
    exportSigningKeys: unsupported("exportSigningKeys"),
    importSigningKeys: unsupported("importSigningKeys"),
  };
}
