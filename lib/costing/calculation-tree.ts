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
