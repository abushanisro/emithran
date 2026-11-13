import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

/** One value of a line's calculation: what it is, its value, and the values its formula is built from. */
export interface CalculationNode {
  name: string;
  value: number | string | null;
  unit: string | null;
  kind: 'input' | 'calculated';
  /** A calculated value's formula, or where an input came from. */
  description: string | null;
  children: CalculationNode[];
}

const refsOf = (formula: string | undefined) => [...new Set([...(formula ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? ''))];

/**
 * The calculation a stored calculator ran for a line (its trace: inputs, then calculated fields in order), as a tree from its result,
 * or from `rootName`. Each calculated value opens onto the fields its formula names; a name the trace does not hold is skipped.
 */
export function buildCalculationTree(trace: readonly CalculationTraceStep[], rootName?: string): CalculationNode | null {
  const byName = new Map(trace.map((s) => [s.fieldName, s]));
  const root = rootName ? byName.get(rootName) : [...trace].reverse().find((s) => s.kind === 'calculated');
  if (root?.kind !== 'calculated') return null;

  const node = (step: CalculationTraceStep, path: ReadonlySet<string>): CalculationNode => {
    const inner = new Set(path).add(step.fieldName);
    const children = step.kind === 'calculated'
      ? refsOf(step.formula).flatMap((n) => {
        const ref = inner.has(n) ? undefined : byName.get(n);
        return ref ? [node(ref, inner)] : [];
      })
      : [];
    return {
      name: step.fieldName,
      value: step.value,
      unit: step.unit ?? null,
      kind: step.kind,
      description: (step.kind === 'calculated' ? step.formula : step.source) ?? null,
      children,
    };
  };
  return node(root, new Set());
}

/** A calculator field as the calculator popup holds it (lib/api/calculators.ts CalculatorField). */
interface PopupField {
  fieldName: string;
  displayLabel?: string;
  fieldType: string;
  unit?: string | null;
  /** A calculated field's formula. */
  defaultValue?: string | null;
}

const numberOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The popup's calculator as calculation steps: each input with the value it holds now (seeded by the engine or edited) and its source, each result
 * with its formula. A result that failed, or an input not set, has no value.
 */
export function calculatorSteps(
  fields: readonly PopupField[],
  inputs: Readonly<Record<string, unknown>>,
  results: Readonly<Record<string, unknown>> | null,
  provenance: Readonly<Record<string, string>>,
): CalculationTraceStep[] {
  return fields.map((f) => {
    const base = { fieldName: f.fieldName, displayLabel: f.displayLabel ?? f.fieldName, unit: f.unit ?? null };
    if (f.fieldType === 'calculated') {
      const r = results?.[f.fieldName];
      const raw = r != null && typeof r === 'object' ? ('error' in r ? null : (r as { value?: unknown }).value) : r;
      return { ...base, kind: 'calculated', value: numberOrNull(raw), ...(f.defaultValue ? { formula: f.defaultValue } : {}) };
    }
    const source = provenance[f.fieldName];
    return { ...base, kind: 'input', value: numberOrNull(inputs[f.fieldName]), ...(source ? { source } : {}) };
  });
}
