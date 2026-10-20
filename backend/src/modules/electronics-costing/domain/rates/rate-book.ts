import { createHash } from 'node:crypto';

// The rates an engine may read, each with where it came from. Engines take rates only from this
// book, so a quote can state exactly which records it used.
//
//  reference     a confirmed engine input (a cycle time, a conveyor speed, ...)
//  machine_rate  a machine-hour rate, from one mhr_records row
//  labour_rate   a labour-hour rate, from one mhr_records row
export type RateKind = 'reference' | 'machine_rate' | 'labour_rate';

export interface RateEntry {
  kind: RateKind;
  /** Reference key (e.g. 'reflow.conveyor_speed') or rate name ('mhr_usd_per_hour', 'lhr_usd_per_hour'). */
  key: string;
  /** The machine name the value belongs to. */
  scope: string;
  value: number;
  unit: string;
  currency?: string;
  /** File or table the value was read from. */
  sourceRef: string;
  /** mhr_records id, when the value is one of its rates. */
  recordId?: string;
  /** The record version stamps at read time (economics_version, then updated_at). */
  recordVersion?: string;
  recordedAt?: string;
}

export interface RateBook {
  entries: readonly RateEntry[];
}

export const EMPTY_RATE_BOOK: RateBook = { entries: [] };

export function findRates(book: RateBook, key: string, scope?: string): RateEntry[] {
  return book.entries.filter((e) => e.key === key && (scope === undefined || e.scope === scope));
}

const identity = (e: RateEntry) => [e.kind, e.key, e.scope, e.recordId ?? ''].join('\u0000');

/** The distinct entries across several engine runs, in a fixed order. */
export function distinctRates(lists: readonly (readonly RateEntry[])[]): RateEntry[] {
  const byIdentity = new Map<string, RateEntry>();
  for (const e of lists.flat()) byIdentity.set(identity(e), e);
  return [...byIdentity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => e);
}

// Canonical JSON: fixed key order, so the same rates always hash the same.
function canonical(e: RateEntry): string {
  return JSON.stringify([
    e.kind, e.key, e.scope, e.value, e.unit, e.currency ?? null, e.sourceRef, e.recordId ?? null, e.recordVersion ?? null, e.recordedAt ?? null,
  ]);
}

/**
 * One value for "which rates did this quote use". It changes when any used rate's value, unit,
 * currency, source or record version changes, and not when the extracted geometry does.
 */
export function rateVersion(used: readonly RateEntry[]): string {
  const lines = distinctRates([used]).map(canonical);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
