// A part's own value for a sand-casting plant variable (migration 961). Pure: what a value may be, and the rows as a map for
// SandReference.withOverrides. Reading and writing the rows is SandVariableOverridesService.

import type { SandReference } from './sand-reference';

export interface SandVariableOverrideRow {
  variable: string;
  value: string;
  reason: string;
  set_by: string;
  set_at: string;
}

/** What a user sees of one override: the plant value next to their own, with why, who and when. */
export interface SandVariableOverrideView {
  variable: string;
  value: string;
  plantValue: string | null;
  unit: string | null;
  reason: string;
  setBy: string;
  setAt: string;
}

/**
 * Checks a new value against the plant variable it replaces. A variable that is a number stays a number (finite); one that is text
 * (an enum such as autoCoreboxCalcMode) takes any non-empty text. A name that is not a plant variable is refused: nothing would read it.
 */
export function checkOverride(ref: SandReference, variable: string, raw: string): { value: string } | { error: string } {
  const plant = ref.plantOrSharedValue(variable);
  if (plant === undefined) return { error: `${variable} is not a sand casting variable` };
  const value = raw.trim();
  if (value === '') return { error: 'The value is empty' };
  const plantIsNumber = plant != null && plant.trim() !== '' && Number.isFinite(Number(plant));
  if (plantIsNumber && !Number.isFinite(Number(value))) return { error: `${variable} is a number (the plant value is ${plant}); "${value}" is not` };
  return { value };
}

/** The rows as the map SandReference.withOverrides takes. */
export function overridesMap(rows: readonly Pick<SandVariableOverrideRow, 'variable' | 'value'>[]): Map<string, string> {
  return new Map(rows.map((r) => [r.variable, r.value]));
}

/** The rows for the user: each with the plant value (from the shared reference) beside the part's own. */
export function overrideViews(ref: SandReference, rows: readonly SandVariableOverrideRow[]): SandVariableOverrideView[] {
  return rows.map((r) => ({
    variable: r.variable,
    value: r.value,
    plantValue: ref.plantOrSharedValue(r.variable) ?? null,
    unit: ref.unit(r.variable),
    reason: r.reason,
    setBy: r.set_by,
    setAt: r.set_at,
  }));
}
