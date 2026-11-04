// Strip and handling time of a core, from the data (lookupTables_Component_tblHandlingTimes): the time to handle a piece of a given weight, with the
// equipment that takes it. The bands are read in order of the weight they take; the first band that takes the core is the one. Pure.
import type { SandReference } from './sand-reference';

export interface HandlingBand {
  equipment: string;
  seconds: number;
  maxKg: number;
  operators: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

/** The bands of the table, lightest first; a row without all of its numbers is not a band. */
export function handlingBands(ref: SandReference): HandlingBand[] {
  return ref
    .table('tblHandlingTimes')
    .flatMap((r) => {
      const seconds = num(r['Handling Time (s)']);
      const maxKg = num(r['Max Weight (kg)']);
      const operators = num(r['Num Operators']);
      return seconds != null && maxKg != null && operators != null ? [{ equipment: String(r['equipment']), seconds, maxKg, operators }] : [];
    })
    .sort((a, b) => a.maxKg - b.maxKg);
}

/** The band that takes `kg`, or null when the table has none that heavy (or no table). */
export function handlingTime(ref: SandReference, kg: number): HandlingBand | null {
  return handlingBands(ref).find((b) => kg <= b.maxKg) ?? null;
}
