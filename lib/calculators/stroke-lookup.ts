// Time Per Stroke as the press-brake calculator shows it: the value, the rows
// of sm_lookup_manual_stroke to outline, and the "Why" text — from the
// backend's manual_stroke lookup response (the same resolver the cost engine
// uses).
import { columnValue } from './lookup-row-match';

export interface StrokeLookupResponse {
  value: number | null;
  row?: unknown;
  resolution?: { policy?: string; nearestRows?: { columns: Record<string, string | number> }[] };
  fromMachineSpec?: boolean;
}

export interface StrokeLookupOutcome {
  value: number;
  /** One table row, the two rows an interpolated value sits between, or null when no table row was used. */
  matchedRows: Record<string, unknown> | Record<string, unknown>[] | null;
  provenance: string;
}

// A table cell for a sentence: strings and numbers as-is, anything else as '?'.
const cell = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '?');

function rowColumns(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  const cols = (row as { columns?: unknown }).columns;
  return cols && typeof cols === 'object' ? (cols as Record<string, unknown>) : (row as Record<string, unknown>);
}

export function describeStrokeLookup(
  lookup: StrokeLookupResponse | null | undefined,
  ctx: { thicknessMm: number; tonnage: number; complexity: 'simple' | 'complex'; machineName?: string | null },
): StrokeLookupOutcome | null {
  if (!lookup || typeof lookup.value !== 'number') return null;
  if (lookup.fromMachineSpec) {
    return {
      value: lookup.value,
      matchedRows: null,
      provenance: `"${ctx.machineName ?? 'selected machine'}" own bend cycle time (machine library) — used instead of the stroke-time table`,
    };
  }
  const bracket = (lookup.resolution?.nearestRows ?? []).map((r) => r.columns);
  if (bracket.length > 0) {
    const [lo, hi] = bracket;
    return {
      value: lookup.value,
      matchedRows: bracket,
      provenance: `sm_lookup_manual_stroke — ${cell(columnValue(lo, 'tonnage') ?? ctx.tonnage)}T class, ${ctx.complexity}: ${String(ctx.thicknessMm)}mm interpolated between the ${cell(columnValue(lo, 'thickness_mm'))}mm and ${cell(columnValue(hi, 'thickness_mm'))}mm rows`,
    };
  }
  return {
    value: lookup.value,
    matchedRows: rowColumns(lookup.row),
    provenance: `sm_lookup_manual_stroke — ${String(ctx.thicknessMm)}mm, ${String(ctx.tonnage)}T machine, ${ctx.complexity}`,
  };
}

/** Press-brake stroke complexity: the calculator's own input, else the part's — 'complex' vs everything else, as the cost engine splits it. */
export function strokeComplexity(calculatorComplexity: unknown, partComplexity: unknown): 'simple' | 'complex' {
  const pick = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return (pick(calculatorComplexity) ?? pick(partComplexity) ?? '').toLowerCase() === 'complex' ? 'complex' : 'simple';
}
