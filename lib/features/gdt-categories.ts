// The tolerance categories of the GD&T tab, in the order the Edit Tolerances
// dialog lists them. `key` is the tblGtolProcessCapabilities GtolCategory the
// backend stores and grades (costing/shared/tolerance/process-capability.ts
// GTOL_CATEGORIES); everything else is display. Units follow the backend
// convention: +/- value for coordinate and diameter tolerances, zone width
// for geometric tolerances, um for roughness, degrees for bend angle.
import type { GtolCategory } from '@/lib/api/hooks/useFeatureTolerances';

export type GdtCategoryGroup = 'coordinate' | 'surface' | 'geometric';

export interface GdtCategoryMeta {
  key: GtolCategory;
  label: string;
  unit: 'mm' | 'µm' | 'deg';
  symbol: string;
  group: GdtCategoryGroup;
  /** Entered as a +/- value (the band is twice it). */
  plusMinus?: boolean;
  note?: string;
}

export const GDT_CATEGORIES: readonly GdtCategoryMeta[] = [
  { key: 'tolerance', label: 'Tolerance (coordinate)', unit: 'mm', symbol: '←→±', group: 'coordinate', plusMinus: true },
  { key: 'roughness', label: 'Roughness Ra', unit: 'µm', symbol: 'Ra', group: 'surface' },
  { key: 'roughnessRz', label: 'Roughness Rz', unit: 'µm', symbol: 'Rz', group: 'surface' },
  { key: 'diamTolerance', label: 'Diam Tolerance', unit: 'mm', symbol: '⌀±', group: 'coordinate', plusMinus: true },
  { key: 'positionTolerance', label: 'True Position', unit: 'mm', symbol: '⌖', group: 'geometric' },
  { key: 'bendAngleTolerance', label: 'Bend Angle Tolerance', unit: 'deg', symbol: '∠±', group: 'coordinate', plusMinus: true, note: 'Bar and tube only' },
  { key: 'circularity', label: 'Circularity', unit: 'mm', symbol: '○', group: 'geometric' },
  { key: 'concentricity', label: 'Concentricity', unit: 'mm', symbol: '◎', group: 'geometric' },
  { key: 'cylindricity', label: 'Cylindricity', unit: 'mm', symbol: '⌭', group: 'geometric' },
  { key: 'flatness', label: 'Flatness', unit: 'mm', symbol: '⏥', group: 'geometric' },
  { key: 'parallelism', label: 'Parallelism', unit: 'mm', symbol: '∥', group: 'geometric' },
  { key: 'perpendicularity', label: 'Perpendicularity', unit: 'mm', symbol: '⟂', group: 'geometric' },
  { key: 'profileOfSurface', label: 'Profile of Surface', unit: 'mm', symbol: '⌓', group: 'geometric' },
  { key: 'runout', label: 'Runout', unit: 'mm', symbol: '↗', group: 'geometric' },
  { key: 'totalRunout', label: 'Total Runout', unit: 'mm', symbol: '⌰', group: 'geometric' },
  { key: 'straightness', label: 'Straightness', unit: 'mm', symbol: '⏤', group: 'geometric' },
  { key: 'symmetry', label: 'Symmetry', unit: 'mm', symbol: '⌯', group: 'geometric' },
  { key: 'angularity', label: 'Angularity', unit: 'mm', symbol: '∠', group: 'geometric' },
];

export const GDT_CATEGORY_BY_KEY: ReadonlyMap<GtolCategory, GdtCategoryMeta> = new Map(GDT_CATEGORIES.map((c) => [c.key, c]));

/** "Diam Tolerance ±0.01 mm", "Flatness 0.05 mm", "Roughness Ra 3.2 µm". */
export function formatRequirement(category: GtolCategory, value: number): string {
  const m = GDT_CATEGORY_BY_KEY.get(category);
  if (!m) return `${category} ${value}`;
  return `${m.label} ${m.plusMinus ? '±' : ''}${value} ${m.unit}`;
}
