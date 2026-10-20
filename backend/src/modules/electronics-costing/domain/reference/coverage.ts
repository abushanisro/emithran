import type { EngineInput, PlannedEngine } from './engine-inputs';

export interface ReferenceRowLike {
  key: string;
  scope: string;
  status: 'sourced' | 'sourced_pending_confirmation';
}

// gap: no row at all. pending_confirmation: only rows nobody has confirmed apply to
// assembled boards. sourced: at least one confirmed row.
export type InputStatus = 'gap' | 'pending_confirmation' | 'sourced';
export type EngineReadiness = 'gap' | 'pending_confirmation' | 'ready';

export interface InputCoverage extends EngineInput {
  status: InputStatus;
  scopes: string[];
}

export interface EngineCoverage {
  id: string;
  label: string;
  family: PlannedEngine['family'];
  readiness: EngineReadiness;
  inputs: InputCoverage[];
}

function inputStatus(rows: ReferenceRowLike[]): InputStatus {
  if (rows.length === 0) return 'gap';
  return rows.some((r) => r.status === 'sourced') ? 'sourced' : 'pending_confirmation';
}

function readiness(inputs: InputCoverage[]): EngineReadiness {
  if (inputs.some((i) => i.status === 'gap')) return 'gap';
  return inputs.some((i) => i.status === 'pending_confirmation') ? 'pending_confirmation' : 'ready';
}

// An engine is ready only when every one of its inputs is sourced and confirmed. Pure.
export function computeCoverage(
  engines: readonly PlannedEngine[],
  rows: readonly ReferenceRowLike[],
): EngineCoverage[] {
  return engines.map((engine) => {
    const inputs = engine.inputs.map((input): InputCoverage => {
      const own = rows.filter((r) => r.key === input.key);
      return { ...input, status: inputStatus(own), scopes: own.map((r) => r.scope) };
    });
    return { id: engine.id, label: engine.label, family: engine.family, readiness: readiness(inputs), inputs };
  });
}

/** Reference rows whose key no planned engine asks for: staged data nothing can use. */
export function orphanKeys(engines: readonly PlannedEngine[], rows: readonly ReferenceRowLike[]): string[] {
  const wanted = new Set(engines.flatMap((e) => e.inputs.map((i) => i.key)));
  return [...new Set(rows.map((r) => r.key).filter((k) => !wanted.has(k)))];
}
