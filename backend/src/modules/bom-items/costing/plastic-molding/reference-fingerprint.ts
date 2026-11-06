// A fingerprint of the staged reference rows a plastic calculation read, so a saved quote can say exactly which data priced it and a later reader can
// tell whether that data has changed since. Pure: the same rows always give the same fingerprint, whatever order they arrived in.
import { createHash } from 'crypto';

/** JSON with object keys sorted at every depth: equal data is equal text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** sha256 of the rows, in hex, shortened to 16 characters (64 bits: enough to tell data sets apart, short enough to show). */
export function fingerprintRows(rows: unknown): string {
  return createHash('sha256').update(stableStringify(rows)).digest('hex').slice(0, 16);
}
