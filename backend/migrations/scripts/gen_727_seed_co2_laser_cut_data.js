// Generates 727_seed_co2_laser_cut_data.sql from real, sourced CO2 laser
// cutting-speed/pierce-time data — see that migration's own header for the
// full root-cause story. Regenerate with:
//   node backend/migrations/scripts/gen_727_seed_co2_laser_cut_data.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../../memory/sheetmetal/lookuptable/sheet_metal_nesting_cut_rate_combined.json');
const OUT = path.resolve(__dirname, '../727_seed_co2_laser_cut_data.sql');

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const rows = data.rows.filter((r) => r.machineType === 'Laser Cut');

// Matches normaliseLaserMaterial()'s real material vocabulary
// (sheet-metal-lookup.service.ts) for Steel -> Carbon Steel / Stainless
// Steel unchanged. 'Cast Iron' is real, sourced data but no grade currently
// classifies to it (normaliseLaserMaterial has no Cast Iron branch) — seeded
// anyway, disclosed as currently-unreachable in the migration header, not
// dropped, so it's ready the moment that classifier gains a real branch.
const MATERIAL_MAP = { Steel: 'Carbon Steel', 'Stainless Steel': 'Stainless Steel', 'Cast Iron': 'Cast Iron' };

function sqlNum(n) {
  if (n == null || !Number.isFinite(n)) return 'NULL';
  return String(n);
}

const values = rows.map((r) => {
  const material = MATERIAL_MAP[r.materialTypeName] || r.materialTypeName;
  const cuttingSpeedMPerMin = r.feedRateLargeFeaturesMmPerMin / 1000;
  const pierceTimeMin = r.pierceTimeS / 60;
  return `  ('${material}', ${sqlNum(r.thicknessMm)}, ${Math.round(r.powerWatts)}, ${sqlNum(cuttingSpeedMPerMin)}, ${sqlNum(pierceTimeMin)}, 'co2')`;
});

const header = `-- ============================================================================
-- Migration 727: Seed real CO2 laser cutting-speed/pierce-time data into
-- sm_lookup_laser_cut (laser_technology = 'co2') — closes the gap migration
-- 457 correctly left open at the time ("no published CO2 table meeting this
-- app's sourcing bar" — that was true on 2026-08-09, using only AMADA's own
-- Quattro documentation).
-- ============================================================================
-- ROOT CAUSE / SOURCE
--
-- memory/sheetmetal/lookuptable/sheet_metal_nesting_cut_rate_combined.json
-- (added 2026-08-20, after migration 457) is a real, carefully-extracted
-- reference dataset (rows dropped rather than guessed whenever a screenshot-
-- sourced value couldn't be confirmed pixel-for-pixel — see its own
-- \`droppedRows\` field) with a \`machineType\` axis: 'Fiber Laser Cut' (301
-- rows, a separate dataset from the one migration 360 already seeded — not
-- touched by this migration) and 'Laser Cut' (${rows.length} rows) — the exact
-- real operation name this app's live catalog uses for the co2_laser class
-- (see migration 722's cross-file reconciliation: "Laser Cutting Machine" /
-- "CO2 Laser Cutter" is the same real 24-machine pool 'Laser Cut' prices
-- against). 'Laser Cut' rows carry real feedRateLargeFeaturesMmPerMin/
-- pierceTimeS across 3 real material families (Steel, Cast Iron, Stainless
-- Steel — code_family 1/10/15), power 2000W-10000W (matches this app's real
-- CO2 machine power range exactly), thickness 0.25mm-50mm.
--
-- Generated deterministically by
-- backend/migrations/scripts/gen_727_seed_co2_laser_cut_data.js — never
-- hand-typed. Re-run that script to regenerate this file if the source JSON
-- changes.
--
-- WHAT IS NOT SEEDED, AND WHY
--
-- kerf_mm: the source has no kerf column for 'Laser Cut' rows at all — left
-- NULL, a real disclosed gap, not fabricated by reusing fiber's kerf-by-
-- thickness values (which would repeat exactly the "fiber data substituted
-- for CO2" mistake migration 457 was written to prevent). This is safe:
-- getLaserParams()'s completeness gate (sheet-metal-lookup.service.ts) no
-- longer requires kerf_mm — confirmed by direct read that LaserCutParams.
-- kerfMm has zero real consumers anywhere in bom-items.service.ts (cost/
-- cycle time comes entirely from cuttingSpeedMPerMin + pierceTimeMin); it
-- was gating real, usable rows on an unused column. Fixed in the same pass.
--
-- 'Cast Iron' rows: real, sourced data, seeded here, but currently
-- unreachable — normaliseLaserMaterial() (sheet-metal-lookup.service.ts)
-- has no branch that returns 'Cast Iron' for any real grade yet. Left in
-- place rather than dropped so it's ready the moment that classifier gains
-- one; inert data, not a fabrication.
--
-- Idempotent: ON CONFLICT (material, thickness_mm, laser_power_w,
-- laser_technology) DO NOTHING — re-running after success is a no-op.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

INSERT INTO sm_lookup_laser_cut (material, thickness_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min, laser_technology) VALUES
${values.join(',\n')}
ON CONFLICT (material, thickness_mm, laser_power_w, laser_technology) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- SELECT laser_technology, material, count(*) FROM sm_lookup_laser_cut
--  WHERE laser_technology = 'co2' GROUP BY laser_technology, material ORDER BY material;
-- -- Expect 3 materials: Carbon Steel, Cast Iron, Stainless Steel.
--
-- SELECT count(*) FROM sm_lookup_laser_cut WHERE laser_technology = 'co2';
-- -- Expect ${rows.length}.
--
-- -- Re-quote a real Sheet Metal part through the 'Laser Cut' route (co2_laser)
-- -- for Carbon Steel or Stainless Steel at a thickness within 0.25-50mm and
-- -- confirm the "no CO2 cutting-speed data" warning is gone and a real,
-- -- non-zero cycle time now appears.
`;

fs.writeFileSync(OUT, header, 'utf8');
console.log(`Wrote ${OUT} with ${rows.length} rows.`);
