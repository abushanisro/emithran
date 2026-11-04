import { apiClient } from "./client";

/** A part's own value for a sand-casting plant variable (backend/src/modules/bom-items/sand-variable-overrides.controller.ts). */
export interface SandVariableOverride {
  variable: string;
  value: string;
  /** What the plant data says, null when the variable has no value. */
  plantValue: string | null;
  unit: string | null;
  reason: string;
  setBy: string;
  setAt: string;
}

const base = (bomItemId: string) =>
  `/bom-items/${encodeURIComponent(bomItemId)}/sand-variable-overrides`;

export const sandVariableOverridesApi = {
  list(bomItemId: string): Promise<{ overrides: SandVariableOverride[] }> {
    return apiClient.get<{ overrides: SandVariableOverride[] }>(base(bomItemId));
  },
  /** Sets one variable for this part (with the reason). The cost is calculated with it from then on. */
  set(
    bomItemId: string,
    variable: string,
    body: { value: string; reason: string },
  ): Promise<{ overrides: SandVariableOverride[] }> {
    return apiClient.put(`${base(bomItemId)}/${encodeURIComponent(variable)}`, body);
  },
  /** Returns one variable to the plant value. */
  clear(bomItemId: string, variable: string): Promise<{ overrides: SandVariableOverride[] }> {
    return apiClient.delete(`${base(bomItemId)}/${encodeURIComponent(variable)}`);
  },
};
