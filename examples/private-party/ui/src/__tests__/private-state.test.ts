import { sampleSigningKey } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no IndexedDB, so replace levelPrivateStateProvider with a fake
// that behaves like it where it matters here: values are scoped by contract
// address (`forContract`, which takes only 32 bytes of hex) and id per
// database + account, and reading a value written under a different password
// throws (AES-GCM auth failure). The real provider in a real browser is
// covered by the checklist in AGENTS.md.
const stores = vi.hoisted(() => new Map<string, Map<string, { password: string; value: unknown }>>());
const levelPrivateStateProvider = vi.hoisted(() =>
  vi.fn(
    (config: {
      midnightDbName: string;
      accountId: string;
      privateStoragePasswordProvider: () => string;
    }) => {
      const key = `${config.midnightDbName}/${config.accountId}`;
      const store = stores.get(key) ?? new Map();
      stores.set(key, store);
      return {
        forContract: (address: string) => {
          if (!/^[0-9a-fA-F]{64}$/.test(address)) throw new Error(`Invalid contract address ${address}`);
          const scoped = (id: string) => `${address.toLowerCase()}:${id}`;
          return {
            get: async (id: string) => {
              const entry = store.get(scoped(id));
              if (!entry) return null;
              if (entry.password !== config.privateStoragePasswordProvider()) {
                throw new Error("Unsupported state or unable to authenticate data");
              }
              return entry.value;
            },
            set: async (id: string, value: unknown) => {
              store.set(scoped(id), { password: config.privateStoragePasswordProvider(), value });
            },
          };
        },
      };
    },
  ),
);
vi.mock("@midnight-ntwrk/midnight-js-level-private-state-provider", () => ({
  levelPrivateStateProvider,
}));

const {
  inMemoryPrivateStateProvider,
  persistentPrivateStateProvider,
  PERSISTENT_DB_NAME,
  WrongPassphraseError,
} = await import("../midnight/private-state");

const PASS = "Correct-Horse-Battery-9";
const ADDR = "ab".repeat(32);
const OTHER_ADDR = "cd".repeat(32);
const SIGNING_KEY = sampleSigningKey();

describe("persistentPrivateStateProvider", () => {
  beforeEach(() => {
    stores.clear();
    levelPrivateStateProvider.mockClear();
  });

  it("opens the account's encrypted store in this UI's database", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    expect(levelPrivateStateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        midnightDbName: PERSISTENT_DB_NAME,
        accountId: "acct-1",
        cryptoBackend: "webcrypto",
      }),
    );
  });

  it("keeps private state across re-opens with the same passphrase", async () => {
    const first = await persistentPrivateStateProvider<"ps", { sk: string }>({
      accountId: "acct-1",
      passphrase: PASS,
    });
    await first.forContract(ADDR).set("ps", { sk: "secret" });

    const second = await persistentPrivateStateProvider<"ps", { sk: string }>({
      accountId: "acct-1",
      passphrase: PASS,
    });
    expect(await second.forContract(ADDR).get("ps")).toEqual({ sk: "secret" });
    expect(await second.forContract(OTHER_ADDR).get("ps")).toBeNull();
  });

  it("rejects a different passphrase at unlock time", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    await expect(
      persistentPrivateStateProvider({ accountId: "acct-1", passphrase: "Wrong-Horse-Battery-9" }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("lets another account choose its own passphrase", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    await expect(
      persistentPrivateStateProvider({ accountId: "acct-2", passphrase: "Other-Horse-Battery-9" }),
    ).resolves.toBeDefined();
  });
});

describe("inMemoryPrivateStateProvider", () => {
  it("keeps each contract's private state apart", async () => {
    const provider = inMemoryPrivateStateProvider<"ps", { sk: string }>();
    await provider.forContract(ADDR).set("ps", { sk: "a" });
    await provider.forContract(OTHER_ADDR).set("ps", { sk: "b" });
    expect(await provider.forContract(ADDR.toUpperCase()).get("ps")).toEqual({ sk: "a" });
    expect(await provider.forContract(OTHER_ADDR).get("ps")).toEqual({ sk: "b" });
    await provider.forContract(ADDR).clear();
    expect(await provider.forContract(ADDR).get("ps")).toBeNull();
    expect(await provider.forContract(OTHER_ADDR).get("ps")).toEqual({ sk: "b" });
  });

  it("rejects an address that isn't 32 bytes of hex, like the persistent store", () => {
    const provider = inMemoryPrivateStateProvider<"ps", { sk: string }>();
    expect(() => provider.forContract("addr")).toThrow();
  });

  it("clearAll drops private states but keeps signing keys", async () => {
    const provider = inMemoryPrivateStateProvider<"ps", { sk: string }>();
    await provider.forContract(ADDR).set("ps", { sk: "a" });
    await provider.setSigningKey(ADDR, SIGNING_KEY);
    await provider.clearAll();
    expect(await provider.forContract(ADDR).get("ps")).toBeNull();
    expect(await provider.getSigningKey(ADDR)).toBe(SIGNING_KEY);
  });
});
