/**
 * Where a calculator input's value was read (the backend's SourceRef on its trace step, cost-breakdown.dto.ts), and how the calculator
 * dialog's eye shows it: the reference table, machine or material record with the row the value came from outlined and the value's column
 * last (the panel's highlighted column), the CAD faces it was measured on, or the calculation that produced it, step by step. Pure: the
 * dialog fetches the rows, this shapes them.
 */
import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

export type SourceRef =
  | { kind: 'variable'; domain: string; name: string }
  | { kind: 'lookup'; domain: string; table: string; column: string; row: Record<string, string | number> | null }
  | { kind: 'machine'; machineId: string; machineName: string; machineClass?: string; location?: string | null; column: string }
  | { kind: 'material'; materialId: string; materialName: string; column: string }
  | { kind: 'cad'; evidence: string }
  | { kind: 'calculation'; name: string; evidence: string | null; steps: CalculationTraceStep[] };

/** The dialog's reference-table panel (ProcessCostDialog lookupTableData). The last column is the one the value is in. */
export interface SourcePanel {
  tableName: string;
  column_definitions: { name: string; label: string; unit?: string }[];
  rows: Record<string, unknown>[];
  /** The row the value came from; null when the source does not say and no single row holds the value. */
  matchedRowKeys: Record<string, unknown> | null;
  /** Shown above the table: how the outlined row was found, or why none is. */
  note?: string;
}

/** An input opens a record or table (the eye beside it) when its ref names one; a CAD ref opens the faces instead. */
export function opensTable(ref: SourceRef | undefined): boolean {
  return !!ref && ref.kind !== 'cad';
}

/** The CAD faces the eye lights for this ref: a measurement's own, or the ones a calculation rests on. */
export function evidenceOfRef(ref: SourceRef | undefined): string | undefined {
  if (ref?.kind === 'cad') return ref.evidence;
  if (ref?.kind === 'calculation') return ref.evidence ?? undefined;
  return undefined;
}

const labelOf = (name: string) => name;
const close = (a: unknown, b: unknown) => {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)) : String(a) === String(b);
};

/** The columns in table order with `column` moved last (the panel highlights the last column as the value). */
function valueColumnLast(columns: readonly string[], column: string) {
  const names = columns.includes(column) ? [...columns.filter((c) => c !== column), column] : [...columns];
  return names.map((name) => ({ name, label: labelOf(name) }));
}

/**
 * A staged lookup table (GET /processes/reference-lookup) for a lookup ref: the row the engine matched, else the one row whose column holds
 * the input's value. Two rows with that value outline neither: picking one would be a guess.
 */
export function lookupPanel(
  ref: Extract<SourceRef, { kind: 'lookup' }>,
  table: { key: string; columns: string[]; rows: Record<string, unknown>[] },
  value: unknown,
): SourcePanel {
  const base = { tableName: table.key.replace(/^lookupTables_Component_/, ''), column_definitions: valueColumnLast(table.columns, ref.column), rows: table.rows };
  if (ref.row) return { ...base, matchedRowKeys: ref.row };
  const holding = table.rows.filter((r) => close(r[ref.column], value));
  const [only] = holding;
  if (holding.length === 1 && only) {
    return { ...base, matchedRowKeys: { [ref.column]: only[ref.column] }, note: `The row whose ${ref.column} is the value in use.` };
  }
  return {
    ...base, matchedRowKeys: null,
    note: holding.length > 1 ? `${holding.length} rows have the value in use: the engine did not record which one it read.` : 'No row holds the value in use (it was changed here).',
  };
}

/**
 * The domain's variables (GET /processes/variables) for a variable ref: the variable's row outlined, its value column last. The endpoint
 * also lists the domain's staged lookup tables, operations, processes and wage grades; only the variables are rows here.
 */
export function variablePanel(
  ref: Extract<SourceRef, { kind: 'variable' }>,
  variables: { key: string; category?: string | null; value: unknown; unitType?: string | null; notes?: string | null }[],
): SourcePanel {
  return {
    tableName: `Variables (${ref.domain.replace(/_/g, ' ')})`,
    column_definitions: [{ name: 'key', label: 'Variable' }, { name: 'unit_type', label: 'Unit' }, { name: 'notes', label: 'Notes' }, { name: 'value', label: 'Value' }],
    rows: variables.filter((v) => v.category == null || v.category === 'variable').map((v) => ({ key: v.key, unit_type: v.unitType ?? null, notes: v.notes ?? null, value: v.value })),
    matchedRowKeys: { key: ref.name },
  };
}

/** A machine or material record among its peers (GET /processes/source-tables/...): the backend already outlines the record by id. */
export function recordPanel(table: { tableName: string; columnDefinitions: SourcePanel['column_definitions']; rows: Record<string, unknown>[]; matchedRowKeys: Record<string, unknown> }): SourcePanel {
  return { tableName: table.tableName, column_definitions: table.columnDefinitions, rows: table.rows, matchedRowKeys: table.matchedRowKeys };
}

/** A calculation ref as a table: each step with where its value came from, the result outlined, values last. */
export function calculationPanel(ref: Extract<SourceRef, { kind: 'calculation' }>): SourcePanel {
  const rows = ref.steps.map((s) => ({
    field: s.displayLabel || s.fieldName,
    source: s.kind === 'calculated' ? (s.formula ?? 'calculated') : (s.source ?? '—'),
    unit: s.unit ?? null,
    value: s.value,
  }));
  const result = [...ref.steps].reverse().find((s) => s.kind === 'calculated');
  return {
    tableName: ref.name,
    column_definitions: [{ name: 'field', label: 'Step' }, { name: 'source', label: 'From' }, { name: 'unit', label: 'Unit' }, { name: 'value', label: 'Value' }],
    rows,
    matchedRowKeys: result ? { field: result.displayLabel || result.fieldName } : null,
    ...(ref.evidence ? { note: 'The faces its CAD measurement was taken on are highlighted on the model.' } : {}),
  };
}
