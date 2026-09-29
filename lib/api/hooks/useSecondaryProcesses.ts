import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';

/** Mirrors backend costing/secondary/secondary-process-engine.ts. */
export interface SecondaryTraceStep {
  label: string;
  value: string | number;
  unit?: string;
  source: string;
}

export interface SecondaryProcessLine {
  process: string;
  machineClass: string;
  status: 'costed' | 'not_applicable' | 'gap';
  reason: string;
  machine: {
    id: string; name: string; mhrUsd: number; lhrUsd: number;
    operators: number; setupHr: number; goodPartYield: number;
  } | null;
  cycleTimeSec: number | null;
  setupMin: number | null;
  materialUsdPerPart: number;
  costPerPartUsd: number | null;
  highlight: 'features' | 'whole_part' | 'none';
  featureIds: string[];
  trace: SecondaryTraceStep[];
  warnings: string[];
  local: { currency: string; machineRate: number | null; laborRate: number | null; costPerPart: number | null };
}

export interface SecondaryProcessesResponse {
  location: string;
  batchSize: number | null;
  materialCutCode: number | null;
  materialTypeName: string | null;
  lines: SecondaryProcessLine[];
  /** Surface treatments from memory/SurfaceTreatment (migrations 819/820). */
  surfaceLines: SecondaryProcessLine[];
  /** Heat treatments from memory/Heat treatment (migrations 823/826). */
  heatTreatmentLines: SecondaryProcessLine[];
  /** The heat-treatment process the drawing callout names, if any. */
  heatTreatmentCalloutProcess: string | null;
  /** Chemical milling (Mask Cure, Scribe, Etch Cell, DeMask) from memory/Machining
   *  (migrations 738/838), costed when the drawing carries a chem-mill callout. */
  chemicalMillingLines: SecondaryProcessLine[];
  /** The drawing's chemical-milling callout text, if any. */
  chemicalMillingCallout: string | null;
  dataWarnings: string[];
}

export function useSecondaryProcesses(itemId: string | undefined, batchSize: number | undefined, location: string) {
  return useQuery({
    queryKey: ['secondary-processes', itemId, batchSize ?? null, location],
    queryFn: () => {
      const params = new URLSearchParams({ location });
      if (batchSize != null) params.set('batchSize', String(batchSize));
      return apiClient.get<SecondaryProcessesResponse>(`/bom-items/${itemId}/secondary-processes?${params}`);
    },
    enabled: useAuthEnabledWith(!!itemId && !!location),
    staleTime: 1000 * 60 * 5,
  });
}

/** Mirrors backend services/nre.service.ts. Money is USD. */
export interface NreItem {
  item: string;
  status: 'costed' | 'gap';
  usd: number | null;
  detail: string;
  source: string;
}
export interface NreResponse {
  items: NreItem[];
  totalUsd: number;
  gaps: number;
  amortization: { enabled: boolean; lifetimeVolume: number | null; perUnitUsd: number | null; reason: string };
}

export function useNre(itemId: string | undefined, batchSize: number | undefined, location: string, productionLifeYears: number | null) {
  return useQuery({
    queryKey: ['nre', itemId, batchSize ?? null, location, productionLifeYears],
    queryFn: () => {
      const params = new URLSearchParams({ location });
      if (batchSize != null) params.set('batchSize', String(batchSize));
      if (productionLifeYears != null) params.set('productionLifeYears', String(productionLifeYears));
      return apiClient.get<NreResponse>(`/bom-items/${itemId}/nre?${params}`, { timeout: 180000 });
    },
    enabled: useAuthEnabledWith(!!itemId && !!location),
    staleTime: 1000 * 60 * 5,
  });
}
