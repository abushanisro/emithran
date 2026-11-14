import { apiClient } from "./client";

/** A priced tooling item from a domain's staged reference data (backend tooling-costs/catalog/tooling-catalog.ts). */
export interface ToolingCatalogItem {
  /** dataset:table:row */
  id: string;
  kind: string;
  name: string;
  details: string;
  unitCostUsd: number;
  unit: "each" | "kg" | "cavity";
  typicalQuantity: number | null;
  source: { dataset: string; table: string; row: number };
}

export interface ToolingCatalogDomain {
  key: string;
  label: string;
}

export interface ToolingCatalog {
  domain: string;
  label: string;
  items: ToolingCatalogItem[];
  /** Rows with no name or price: a gap in the reference data, never costed at zero. */
  unpriced: Array<{ table: string; name: string }>;
  missingTables: string[];
}

export const toolingCatalogsApi = {
  domains(): Promise<ToolingCatalogDomain[]> {
    return apiClient.get("/tooling-catalogs");
  },
  get(domain: string): Promise<ToolingCatalog> {
    return apiClient.get(`/tooling-catalogs/${encodeURIComponent(domain)}`);
  },
};
