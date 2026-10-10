/**
 * Which processes a recognised gear (CAD AxiGroove) needs, from the reference
 * tblGearQuality (migration 739): each AGMA / DIN quality says whether the
 * gear must be shaved or ground after it is cut. The quality comes from the
 * drawing (drawing_intelligence.gear_quality: "A8" / "Q10" / "DIN7"); with no
 * callout it is the reference default, variables gearQualityDefaultAgmaNewStd.
 * An explicit shaving callout adds shaving; an explicit shaping callout means
 * the teeth are shaped instead of hobbed (product decision 2026-09-29).
 */

export interface GearQualityRow {
  old_agma_quality_number: string;
  new_agma_quality_number: string;
  din_quality_number: number;
  must_grind: boolean;
  must_shave: boolean;
}

export interface GearRoute {
  /** The tblGearQuality row the route follows, or null when none matches. */
  quality: GearQualityRow | null;
  qualitySource: string;
  cut: 'hobbing' | 'shaping';
  shave: boolean;
  shaveSource: string | null;
  grind: boolean;
}

const callout = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.trim().toLowerCase() !== 'none' ? v.trim() : null;

function findGearQuality(rows: GearQualityRow[], quality: string): GearQualityRow | null {
  const q = quality.trim().toUpperCase();
  const din = /^DIN\s*(\d+)$/.exec(q);
  return rows.find((r) =>
    (din && Number(r.din_quality_number) === Number(din[1]))
    || String(r.new_agma_quality_number).toUpperCase() === q
    || String(r.old_agma_quality_number).toUpperCase() === q) ?? null;
}

export function resolveGearRoute(
  drawingIntelligence: any,
  rows: GearQualityRow[],
  defaultQuality: string | null,
): GearRoute {
  const called = callout(drawingIntelligence?.gear_quality);
  const quality = called ?? defaultQuality;
  const row = quality ? findGearQuality(rows, quality) : null;
  const qualitySource = called
    ? `drawing gear quality ${called}`
    : defaultQuality ? `reference default quality ${defaultQuality} (variables gearQualityDefaultAgmaNewStd; no quality on the drawing)` : 'no gear quality';
  const shavingCallout = callout(drawingIntelligence?.gear_shaving);
  const shave = shavingCallout != null || row?.must_shave === true;
  return {
    quality: row,
    qualitySource,
    cut: callout(drawingIntelligence?.gear_shaping) ? 'shaping' : 'hobbing',
    shave,
    shaveSource: shavingCallout ? `drawing callout "${shavingCallout}"` : row?.must_shave ? `tblGearQuality ${row.new_agma_quality_number}: must shave` : null,
    grind: row?.must_grind === true,
  };
}
