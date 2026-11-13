import { apiClient } from "./client";

/** A part's own value for one field of a stored calculator (backend calculator-field-overrides.controller.ts, migration 1011). */
export interface CalculatorFieldOverride {
  calculator: string;
  field: string;
  value: number;
  reason: string;
  setBy: string;
  setAt: string;
}

const path = (bomItemId: string) => `/bom-items/${encodeURIComponent(bomItemId)}/calculator-field-overrides`;

export const calculatorFieldOverridesApi = {
  list(bomItemId: string): Promise<{ overrides: CalculatorFieldOverride[] }> {
    return apiClient.get(path(bomItemId));
  },
  /** Sets one field of one calculator for this part (with the reason). The cost is calculated with it from then on. */
  set(bomItemId: string, body: { calculator: string; field: string; value: number; reason: string }): Promise<{ overrides: CalculatorFieldOverride[] }> {
    return apiClient.put(path(bomItemId), body);
  },
  /** Returns one field to the calculator for this part. */
  clear(bomItemId: string, calculator: string, field: string): Promise<{ overrides: CalculatorFieldOverride[] }> {
    return apiClient.delete(`${path(bomItemId)}?calculator=${encodeURIComponent(calculator)}&field=${encodeURIComponent(field)}`);
  },
};
