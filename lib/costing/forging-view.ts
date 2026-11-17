import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type ForgingSummary = NonNullable<CostSummaryDto['forging']>;

/** A hammer's blow energy or a press's force as the Cost Guide shows it: joules under a kilojoule (a small part's blow is a few hundred J), kN to the unit. */
export function formatForming(forming: ForgingSummary['forming']): string {
  if (forming.quantity === 'force_kn') return `${Math.round(forming.value).toLocaleString('en-US')} kN`;
  return forming.value < 1000 ? `${Math.round(forming.value)} J` : `${(forming.value / 1000).toFixed(1)} kJ`;
}

/** The scenario keys of the forging settings set over the engine's (backend forging-cost.service.ts FORGING_OVERRIDE_KEYS). */
export const FORGING_SCENARIO_KEYS = {
  complexity: 'forgingComplexity',
  barDiameterMm: 'forgingBarDiameterMm',
  heating: 'forgingHeating',
  hits: 'forgingHits',
  flashThicknessMm: 'forgingFlashThicknessMm',
  flashWidthMm: 'forgingFlashWidthMm',
} as const;

/** How many of the forging settings the engineer set (complexity included). */
export function forgingOverrideCount(overrides: Record<string, unknown> | null | undefined): number {
  return Object.values(FORGING_SCENARIO_KEYS).filter((k) => overrides?.[k] != null).length;
}

/** A whole, positive number of blows, or an empty field (the data's). */
export function parseBlows(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}
