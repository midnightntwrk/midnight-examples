// Privacy checks over a decoded public ledger.
//
// Replaces the hand-written collect…Bytes / findLeak pairs that were in
// examples/shielded-chips/src/test/privacy.test.ts and
// examples/private-tip-jar/src/test/private-tip-jar.test.ts. The walker
// follows the ledger itself, so a new ledger field is covered without
// editing a list.

/** One byte string found in public state, with the path it was found at. */
export interface PublicBytes {
  label: string;
  bytes: Uint8Array;
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

const isIterable = (v: object): v is Iterable<unknown> =>
  typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';

/**
 * Collects every byte string in a decoded ledger (the object `ledger(state)`
 * returns, or anything shaped like it): plain fields, struct fields, and the
 * entries of Map, Set and List ADTs. Map entries are labelled
 * `field[i].key` / `field[i].value`; Set and List entries `field[i]`.
 */
export function collectPublicBytes(ledger: unknown, root = ''): PublicBytes[] {
  const out: PublicBytes[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, label: string): void => {
    if (v instanceof Uint8Array) {
      out.push({ label, bytes: v });
      return;
    }
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${label}[${i}]`));
      return;
    }
    if (isIterable(v)) {
      // A Map ADT has lookup() and yields [key, value] pairs.
      const isMap = typeof (v as { lookup?: unknown }).lookup === 'function';
      let i = 0;
      for (const entry of v) {
        if (isMap && Array.isArray(entry) && entry.length === 2) {
          walk(entry[0], `${label}[${i}].key`);
          walk(entry[1], `${label}[${i}].value`);
        } else {
          walk(entry, `${label}[${i}]`);
        }
        i++;
      }
      return;
    }
    for (const key of Object.keys(v)) {
      const field = (v as Record<string, unknown>)[key];
      if (typeof field === 'function') continue;
      walk(field, label ? `${label}.${key}` : key);
    }
  };
  walk(ledger, root);
  return out;
}

/**
 * Returns the label of the first public byte string that contains `secret`,
 * or null. Containment, not equality: a secret embedded in a larger field
 * (a struct encoded as bytes, a padded value) still counts as a leak.
 */
export function findInPublicState(ledger: unknown, secret: Uint8Array): string | null {
  const target = hex(secret);
  if (target.length === 0) return null;
  for (const { label, bytes } of collectPublicBytes(ledger)) {
    if (hex(bytes).includes(target)) return label;
  }
  return null;
}

/**
 * Throws if any secret appears anywhere in the decoded ledger, naming the
 * secret and the field it was found in. `secrets` maps a name (used in the
 * message) to its bytes; write one entry per "never on chain" line of the
 * example's SPEC.md.
 */
export function assertNotInPublicState(ledger: unknown, secrets: Record<string, Uint8Array>): void {
  const leaks: string[] = [];
  for (const [name, bytes] of Object.entries(secrets)) {
    const field = findInPublicState(ledger, bytes);
    if (field !== null) leaks.push(`${name} found in public state at ${field}`);
  }
  if (leaks.length > 0) throw new Error(`privacy invariant broken:\n  ${leaks.join('\n  ')}`);
}
