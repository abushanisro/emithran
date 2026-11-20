import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type BarTubeSummary = NonNullable<CostSummaryDto['barTube']>;

/** The scenario key of the bar and tube route set over the engine's choice (backend bar-tube-cost.service.ts BAR_TUBE_ROUTE_KEY). */
export const BAR_TUBE_SCENARIO_KEYS = { route: 'barTubeRoute' } as const;

/** The route set in the Cost Guide, or null: the engine quotes the cheapest complete one. */
export function barTubeRouteOf(overrides: Record<string, unknown> | null | undefined): string | null {
  const v = overrides?.[BAR_TUBE_SCENARIO_KEYS.route];
  return typeof v === 'string' && v ? v : null;
}

/** "ROUND_TUBE" -> "Round tube". */
export function stockFormLabel(form: string): string {
  const s = form.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The section as an engineer reads it: "Ø25 x 1.5 mm", "50 x 6 mm", "30 x 20 x 2 mm". */
export function sectionLabel(b: Pick<BarTubeSummary, 'stockForm' | 'sectionWidthMm' | 'sectionHeightMm' | 'wallMm'>): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const round = b.stockForm === 'ROUND_TUBE' || b.stockForm === 'ROUND_BAR';
  const size = round ? `Ø${n(b.sectionWidthMm)}` : `${n(b.sectionWidthMm)} x ${n(b.sectionHeightMm)}`;
  return `${size}${b.wallMm != null && b.stockForm !== 'RECTANGULAR_BAR' ? ` x ${n(b.wallMm)}` : ''} mm`;
}

/** A rotary draw tool key (bending_difficulty_factor: letter = wiper, digit = mandrel pitch) as words. */
export function toolKeyLabel(key: string | null): string | null {
  if (!key) return null;
  const wiper: Record<string, string> = { A: 'no wiper', B: 'standard mandrel and wiper', C: 'high pressure mandrel and wiper' };
  const d = Number(key.slice(1));
  const mandrel = d === 0 ? 'no mandrel' : d <= 3 ? 'regular pitch mandrel' : d <= 6 ? 'close pitch mandrel' : 'double close pitch mandrel';
  const letter = key.slice(0, 1);
  return `${key}: ${wiper[letter] ?? letter}, ${mandrel}`;
}
