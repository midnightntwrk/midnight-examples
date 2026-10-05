// The repo-wide wallet file: ONE `.env` at the repo root holds the test wallets
// for every example.
//
// Each remote network gets three wallet slots. An example maps its roles onto
// slots (Alice = 1, Bob = 2, Charlie = 3, ...), so the same three funded wallets
// serve every example instead of each example needing its own seeds:
//
//   MIDNIGHT_PREPROD_WALLET_1_SEED=<64 hex chars>     (or _MNEMONIC=<24 words>)
//   MIDNIGHT_PREPROD_WALLET_1_BIRTHDAY=2203999        (optional; enables fast-sync)
//
// A slot that is missing is GENERATED on first use: a random seed, plus its
// birthday — the chain tip at the moment it was created. The birthday is what
// makes fast-sync safe (see FAST-SYNC.md): a wallet born at or after the shipped
// reference's height cannot have history before it, so it may start from the
// reference instead of genesis. A seed you paste in WITHOUT a birthday is treated
// as a wallet with unknown history and takes a normal full sync.
//
// The local devnet ('undeployed') never touches the file: it uses the genesis
// seeds 0x…01, 0x…02, 0x…03, which the local node pre-funds.
//
// Shell environment variables always win over values in the file.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { Logger } from 'pino';
import { type FastSyncOptions, getChainTipHeight } from './fast-sync/fast-wallet.js';
import type { WalletSecret } from './secret.js';

/** How many wallet slots the root `.env` carries per network. */
export const WALLET_SLOTS = 3;

/** The repo-root `.env`. Override with MIDNIGHT_ENV_FILE (e.g. for CI secrets). */
export const ENV_FILE =
  process.env['MIDNIGHT_ENV_FILE'] ?? fileURLToPath(new URL('../../../.env', import.meta.url));

/** The shipped pre-seed reference bundles (`<networkId>/{manifest.json,*.dat.gz}`). */
export const REFERENCE_ROOT = fileURLToPath(new URL('../preseed', import.meta.url));

/** The network id the local devnet uses; it is served by genesis seeds, not the file. */
const LOCAL_NETWORK_ID = 'undeployed';

/** The genesis seed for a slot on the local devnet. Slots 1–3 are pre-funded there. */
export function localSeed(slot: number): string {
  return slot.toString(16).padStart(64, '0');
}

/** The variable names for one slot on one network, e.g. MIDNIGHT_PREVIEW_WALLET_2_SEED. */
export function walletEnvKeys(networkId: string, slot: number) {
  const prefix = `MIDNIGHT_${networkId.toUpperCase()}_WALLET_${slot}`;
  return {
    seed: `${prefix}_SEED`,
    mnemonic: `${prefix}_MNEMONIC`,
    birthday: `${prefix}_BIRTHDAY`,
  };
}

/**
 * Read the root `.env` into `process.env`, without overwriting anything already
 * set (the shell wins). A blank value counts as unset, so a `KEY=` placeholder
 * that a test runner loaded earlier never hides a wallet generated since.
 * Returns what the file contained; `{}` when it is absent.
 */
export function loadRootEnv(file = ENV_FILE): Record<string, string> {
  if (!existsSync(file)) return {};
  const parsed = parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
  return parsed;
}

/** Where a resolved wallet came from. */
export type WalletSource = 'local' | 'env' | 'generated';

export interface ResolvedWallet {
  slot: number;
  secret: WalletSecret;
  /** Pass to MidnightWalletProvider.build; undefined means a normal full sync. */
  fastSync?: FastSyncOptions;
  /** Chain height the wallet was created at, when known. */
  birthday?: number;
  source: WalletSource;
}

export interface ResolveWalletOptions {
  /**
   * Seed to use for this slot on the local devnet instead of the genesis seed —
   * e.g. a deliberately unfunded wallet (private-party's sponsored guest).
   */
  localSeed?: string;
}

function parseBirthday(key: string, raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${key} must be a positive integer block height, got '${raw}'.`);
  }
  return n;
}

// The slot's secret as currently configured (shell, then file), or null when the
// slot is empty.
function readSlot(networkId: string, slot: number): { secret: WalletSecret; birthday?: number } | null {
  const keys = walletEnvKeys(networkId, slot);
  const mnemonic = process.env[keys.mnemonic]?.trim().replace(/\s+/g, ' ');
  const seed = process.env[keys.seed]?.trim();
  if (mnemonic && seed) {
    throw new Error(`Set only one of ${keys.mnemonic} or ${keys.seed} (both are defined).`);
  }
  const birthday = parseBirthday(keys.birthday, process.env[keys.birthday]);
  if (mnemonic) return { secret: { kind: 'mnemonic', value: mnemonic }, birthday };
  if (seed) {
    if (!/^[0-9a-fA-F]+$/.test(seed) || seed.length % 2 !== 0) {
      throw new Error(`${keys.seed} must be a hex string of even length (no 0x prefix).`);
    }
    return { secret: { kind: 'seed', value: seed }, birthday };
  }
  return null;
}

// Save a freshly generated slot to the root `.env`. Blank placeholders copied from
// .env.example (`KEY=`) are filled in place; otherwise the slot is appended. The
// file is kept owner-only: it holds spendable (testnet) keys.
function saveSlot(file: string, networkId: string, slot: number, seed: string, birthday: number): void {
  const keys = walletEnvKeys(networkId, slot);
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing: string[] = [];
  for (const [key, value] of [
    [keys.seed, seed],
    [keys.birthday, String(birthday)],
  ] as const) {
    const blank = new RegExp(`^${key}=[ \\t]*$`, 'm');
    if (blank.test(text)) text = text.replace(blank, `${key}=${value}`);
    else missing.push(`${key}=${value}`);
  }
  if (missing.length > 0) {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
    text += `\n# ${networkId} wallet ${slot} — generated ${new Date().toISOString()}\n${missing.join('\n')}\n`;
  }
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600); // `mode` above only applies when the file is created
}

/**
 * Resolve the wallet for `slot` on the network `config` points at.
 *
 * - Local devnet: the genesis seed for the slot (or `opts.localSeed`).
 * - Remote: the slot from the root `.env` (shell overrides win). A slot with a
 *   birthday fast-syncs from the shipped reference; one without does a full sync.
 * - Remote, slot empty: generate a fresh seed, record its birthday, save both
 *   to the root `.env`, and fast-sync it. The new wallet holds nothing yet — the
 *   caller must fund it (see `fundWallets`).
 */
export async function resolveWallet(
  logger: Logger,
  config: { networkId: string; indexer: string },
  slot: number,
  opts: ResolveWalletOptions = {},
): Promise<ResolvedWallet> {
  const { networkId } = config;
  if (networkId === LOCAL_NETWORK_ID) {
    return { slot, secret: { kind: 'seed', value: opts.localSeed ?? localSeed(slot) }, source: 'local' };
  }

  loadRootEnv();
  const configured = readSlot(networkId, slot);
  if (configured) {
    const { secret, birthday } = configured;
    logger.info(
      birthday === undefined
        ? `Wallet ${slot}: ${secret.kind} from ${ENV_FILE}, no birthday — full sync.`
        : `Wallet ${slot}: ${secret.kind} from ${ENV_FILE} (birthday ${birthday}) — fast-sync.`,
    );
    return {
      slot,
      secret,
      birthday,
      fastSync: birthday === undefined ? undefined : { referenceRoot: REFERENCE_ROOT, birthday },
      source: 'env',
    };
  }

  // Nothing configured: generate. The birthday MUST be read before the seed is
  // used anywhere, or the fast-sync guard has nothing trustworthy to compare.
  const birthday = await getChainTipHeight(config.indexer);
  if (birthday === undefined) {
    throw new Error(
      `Could not read the ${networkId} chain tip from ${config.indexer} to set a birthday for new wallet ${slot}.`,
    );
  }
  const seed = randomBytes(32).toString('hex');
  saveSlot(ENV_FILE, networkId, slot, seed, birthday);
  const keys = walletEnvKeys(networkId, slot);
  process.env[keys.seed] = seed;
  process.env[keys.birthday] = String(birthday);
  logger.info(`Wallet ${slot}: generated a new ${networkId} wallet (birthday ${birthday}) and saved it to ${ENV_FILE}.`);
  return {
    slot,
    secret: { kind: 'seed', value: seed },
    birthday,
    fastSync: { referenceRoot: REFERENCE_ROOT, birthday },
    source: 'generated',
  };
}
