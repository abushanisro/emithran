// One-off generator for migration 590. Not part of the migration itself —
// run manually to (re)produce the SQL from the source JSON, then inspect the
// diff before committing. Kept here rather than deleted so the exact
// transformation logic (field mapping, unit conversion, null handling) is
// re-derivable later instead of only living in a frozen SQL blob.
//
// SUPERSEDED (2026-08-28, user: "remove the group"): every 'Sheet Metal'
// literal below is what migration 590 actually ran with — left as-is
// because 590.sql is already executed live and rewriting it here would
// misrepresent history. Migration 592 retags every row this script created
// back to 'Ferrous & Non-Ferrous' — there is no longer a separate 'Sheet
// Metal' material_group in the live DB. Do NOT regenerate 590.sql from this
// script expecting the current group scheme; if this dataset is ever
// re-imported from scratch, use 'Ferrous & Non-Ferrous' instead of 'Sheet
// Metal' throughout.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'memory', 'sheetmetal', 'rawmetrial', 'rawmetalusa.json');
const OUT = path.join(__dirname, '..', '590_seed_sheet_metal_raw_materials.sql');

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function materialType(primaryId) {
  const idx = primaryId.indexOf(',');
  if (idx !== -1) return primaryId.slice(0, idx).trim();
  if (primaryId.startsWith('C60')) return 'Carbon Steel';
  if (primaryId.startsWith('Hastelloy')) return 'Hastelloy';
  if (primaryId.startsWith('Haynes')) return 'Haynes Alloy';
  if (primaryId.startsWith('Inconel')) return 'Inconel';
  return primaryId;
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  // Explicit ::numeric cast on NULL, not just a bare NULL literal: Postgres
  // infers a VALUES column's type from the union of all rows' literals, and
  // milling_speed_m_min is NULL in every single one of the 98 promoted rows
  // (MillingSpeed_m_min is 0.0 -- a not-populated sentinel, see header -- on
  // every row that has it at all) -- an all-bare-NULL column has no numeric
  // literal anywhere to infer from, so Postgres defaulted it to `text`,
  // which then failed to insert into the numeric milling_speed_m_min column
  // ("column ... is of type numeric but expression is of type text"). Cast
  // every NULL here, not just that one column, so no other column can hit
  // the same failure if a future data change makes it all-null too.
  if (v === null || v === undefined) return 'NULL::numeric';
  return String(v);
}

// ── Explicit, documented corrections to specific rows (applied to a working
// copy for PROMOTION only — the sm_reference_data staging copy always keeps
// the untouched original, see rawJsonb()). Each entry says exactly what was
// wrong and why the correction is not a guess. No entry here invents a
// number that isn't either (a) swapping two fields already present in the
// same row, (b) a real published standard's guaranteed minimum, or (c)
// nulling a field that is physically impossible / a literal copy of a
// different field's value.
const CORRECTIONS = {
  'Brass, UNS C36000': (v) => {
    // Source has TYS(430) > UTS(260), impossible. Swapping resolves it AND
    // makes Shear(280) fall between TYS/UTS with a plausible ~0.65 Shear/UTS
    // ratio for brass -- a transposition, not a merge with another source.
    v.TYS_MPa = 260; v.UTS_MPa = 430;
  },
  'Copper, UNS C11000': (v) => {
    // ShearStrength_MPa (115000) is a literal copy of this row's own
    // YoungsModulus_MPa (115000) -- physically impossible as a strength in
    // MPa, clearly a copy-paste artifact. TYS(345) > UTS(207) is also
    // impossible, and unlike the Brass row above, swapping them does not
    // land near any real ETP copper reference value -- so rather than
    // guess a swap, all three are replaced with the real, published,
    // annealed-C11000 (ETP copper) values this codebase already vetted and
    // uses for the identical alloy in migration 353 ('C11000 Copper', UTS
    // 220 / YTS 69 MPa -- standard ASM/CDA reference figures for the
    // generic annealed condition, the same condition this "Generic Copper,
    // UNS C11000" row's naming implies). Shear strength (150 MPa) is the
    // standard published ASM Metals Handbook / Copper Development
    // Association figure for annealed C11000 -- not derived from this row's
    // corrupted numbers or from any formula.
    v.TYS_MPa = 69; v.UTS_MPa = 220; v.ShearStrength_MPa = 150;
  },
  'Steel, AISI 4140, Medium-Carbon': (v) => {
    // TYS(825) > UTS(491), impossible. Swapped (TYS 491 / UTS 825) lands in
    // the real range for a quenched-and-tempered 4140 condition -- a
    // transposition, not a fabricated new value.
    v.TYS_MPa = 491; v.UTS_MPa = 825;
  },
};

// Copper/brass family shares ScrapPct=100 across all 6 "Copper, UNS ..."
// rows (Brass's own C36000 row uses a distinct, plausible 31 and is NOT
// included here). A 100% scrap rate is not physically sensible for a raw
// material input (it would mean no finished good is ever produced from it).
// Unlike the mechanical properties above, there is no published standard to
// cite a real scrap/yield-loss percentage from -- it's a shop/process
// economics parameter, not a material constant -- so there is no root-cause
// number available here (any figure would be an invented placeholder, not a
// looked-up fact). Nulled rather than promoted as a live scrap_factor = 1.0
// that a future costing consumer could take literally.
const NULL_SCRAP_FACTOR_FOR = new Set([
  'Copper, UNS C11000', 'Copper, UNS C18150', 'Copper, UNS C27200',
  'Copper, UNS C28000', 'Copper, UNS C51900', 'Copper, UNS C62730',
]);

// Wholesale-duplicated-from-an-unrelated-alloy rows (see migration header):
// every mechanical field is either copied verbatim from 'Steel, Hot Worked,
// AISI 6150' or otherwise inconsistent (HardnessSystem = 'Tensile Strength'
// appears on ONLY these two rows out of all 101 -- every other row uses
// 'Brinell'). Fields are replaced with real, citable, published values from
// each grade's own named standard wherever the standard actually specifies
// one -- not left null just because the source's copy was wrong. Left NULL
// only where the standard itself does not guarantee a single number (a
// property it doesn't test/certify, or a genuine two-sided range where any
// single point would be a guess):
//   ASTM A572/A572M-18 Grade 50 (US structural HSLA plate):
//     - Yield strength: 50 ksi = 345 MPa (guaranteed MINIMUM, no ceiling)
//     - Tensile strength: 65 ksi = 450 MPa (also a guaranteed MINIMUM, no
//       ceiling specified by A572 -- unlike S235JR below, so this one IS
//       usable as a single number)
//     - Hardness, shear strength, K/n/R: A572 does not test or certify any
//       of these -- no standard-guaranteed number exists, left NULL.
//   EN 10025-2:2019 S235JR (EU structural steel, t <= 16mm):
//     - Yield strength: 235 MPa (guaranteed minimum -- the "235" in the name)
//     - Tensile strength: EN 10025-2's own table specifies a genuine
//       TWO-SIDED range, 360-510 MPa -- no single guaranteed number exists,
//       so (matching migration 386's SECC precedent of never picking an
//       arbitrary point in a two-sided spec range) left NULL rather than
//       guessing a midpoint.
//     - Hardness, shear strength, K/n/R: not specified by EN 10025-2 either,
//       left NULL for the same reason as A572 above.
// YoungsModulus_MPa (116000) / PoissonsRatio (0.34) on both rows were also
// part of the AISI-6150 copy-paste, not real steel values -- replaced with
// 207000 MPa / 0.28, the standard values (and the same figures this exact
// dataset's own sibling "Steel, Hot Worked, AISI ..." rows already use).
const WHOLESALE_CORRUPTED = {
  'Steel, Hot Worked, ASTM A572 Grade 50': (v) => {
    v.Hardness = null; v.HardnessSystem = null;
    v.TYS_MPa = 345; v.UTS_MPa = 450; v.ShearStrength_MPa = null;
    v.K_MPa = null; v.n_exp = null; v.R_Lankford = null;
    v.YoungsModulus_MPa = 207000; v.PoissonsRatio = 0.28;
  },
  'Steel, Hot Worked, Grade S235JR': (v) => {
    v.Hardness = null; v.HardnessSystem = null;
    v.TYS_MPa = 235; v.UTS_MPa = null; v.ShearStrength_MPa = null;
    v.K_MPa = null; v.n_exp = null; v.R_Lankford = null;
    v.YoungsModulus_MPa = 207000; v.PoissonsRatio = 0.28;
  },
};

// Pure cost/density stubs -- every other field is null, so promoting them as
// full 'Sheet Metal' catalog rows adds no differentiated technical
// information, just a confusing near-empty entry (in Titanium's case,
// sharing a name with a DIFFERENT, fully-populated existing row from
// migration 353). Still staged in sm_reference_data (their cost data is
// real and may be useful later).
//
// OVERRIDDEN (2026-08-28, user: "dont skip anything"): migration 590 itself
// already ran live with this set non-empty (98 promotions, these 3
// excluded) -- left as-is here so this script still reflects what 590
// actually did when it ran, rather than silently rewriting history. The 3
// excluded rows were promoted separately by a small follow-up migration
// (since deleted -- its only content was these 3 rows, and 'Sheet Metal' as
// a group value no longer exists after the group-removal migration below;
// the rows themselves are permanently live, correctly tagged 'Ferrous &
// Non-Ferrous', with real cost/density and every mechanical field genuinely
// NULL because the source has no data for them). Do NOT regenerate 590.sql
// from an emptied version of this set -- it would no longer match the live
// DB.
const SKIP_PROMOTION = new Set([
  'Steel, Hot Worked, S900MC',
  'Titanium, Ti-5Al-2.5Sn',
  'Titanium, Ti-6Al-4V',
]);

// jsonb literal for the staged raw payload — DataSource is neutralized (never
// store the licensed vendor name in the DB), and MillingSpeed_m_min's
// universal 0.0 sentinel (see migration header) is preserved AS-IS here since
// this is a lossless staging copy of the source, not the promoted value.
function rawJsonb(row) {
  const copy = { ...row };
  if (copy.DataSource) copy.DataSource = 'USA reference material library';
  return `'${JSON.stringify(copy).replace(/'/g, "''")}'::jsonb`;
}

const stageRows = [];
const promoteRows = [];
let skipped = 0;
let corrected = 0;

for (const row of data) {
  const primaryId = row.PrimaryID;

  // Staging always gets the untouched original (audit trail).
  stageRows.push(
    `('material', 'USA', '2026-08', ${sqlStr(primaryId)}, ${sqlStr(row.UnitCost_USD_kg)}, 'USD/kg', 'Sheet metal raw material property reference row', ${rawJsonb(row)})`
  );

  if (SKIP_PROMOTION.has(primaryId)) { skipped++; continue; }

  // Promotion works on a corrected copy — never mutate the object used above.
  const v = { ...row };
  if (CORRECTIONS[primaryId]) { CORRECTIONS[primaryId](v); corrected++; }
  if (WHOLESALE_CORRUPTED[primaryId]) { WHOLESALE_CORRUPTED[primaryId](v); corrected++; }

  const material = v.OtherID; // matches existing "Generic X" naming convention already used in raw_materials
  const grade = v.PrimaryID;
  const mtype = materialType(primaryId);

  const densityKgM3 = v.Density_kg_m3;
  const density = densityKgM3 != null ? +(densityKgM3 / 1000).toFixed(4) : null;
  const costUsd = v.UnitCost_USD_kg; // authoritative — BaseCostPerUnit_USD is unreliable, see migration header
  const scrapFactor = (v.ScrapPct != null && !NULL_SCRAP_FACTOR_FOR.has(primaryId)) ? +(v.ScrapPct / 100).toFixed(4) : null;
  const elasticModulusGpa = v.YoungsModulus_MPa != null ? +(v.YoungsModulus_MPa / 1000).toFixed(4) : null;
  const poissonRatio = v.PoissonsRatio;
  const millingSpeed = v.MillingSpeed_m_min === 0 ? null : v.MillingSpeed_m_min; // 0.0 is a universal unpopulated sentinel, see header

  promoteRows.push(
    `(${sqlStr(material)}, ${sqlStr(grade)}, ${sqlStr(mtype)}, 'Sheet Metal', ` +
    `${sqlNum(densityKgM3)}, ${sqlNum(density)}, ` +
    `${sqlNum(v.UTS_MPa)}, ${sqlNum(v.TYS_MPa)}, ${sqlNum(v.ShearStrength_MPa)}, ` +
    `${sqlNum(v.Hardness)}, ${sqlStr(v.HardnessSystem)}, ` +
    `${sqlNum(elasticModulusGpa)}, ${sqlNum(poissonRatio)}, ` +
    `${sqlNum(v.K_MPa)}, ${sqlNum(v.n_exp)}, ${sqlNum(v.R_Lankford)}, ` +
    `${sqlNum(scrapFactor)}, ${sqlNum(millingSpeed)}, ` +
    `${sqlNum(costUsd)}, ${sqlNum(costUsd)}, 'USD')`
  );
}

const sql = `-- ============================================================================
-- Migration 590: Seed Sheet Metal raw-material property reference data (2026-08-28)
--
-- Source: memory/sheetmetal/rawmetrial/rawmetalusa.json -- 101 USA-region raw
-- material property rows (aluminum/steel/stainless/galvanized steel/copper/
-- brass/titanium/nickel-superalloy grades), each carrying density, cost,
-- hardness, UTS/YTS/shear strength, elastic modulus, Poisson's ratio, and
-- (new to this DB) sheet-forming parameters: strain-hardening strength
-- coefficient K, strain-hardening exponent n, and the Lankford (normal
-- anisotropy) coefficient R -- all directly usable inputs for Sheet Metal
-- DFM/springback and deep-draw formability work per the domain roadmap.
--
-- Provenance: the source file's own "DataSource" field names a specific
-- licensed reference-data vendor. Per standing project policy that name is
-- never stored in this codebase/DB -- it is replaced with the neutral phrase
-- 'USA reference material library' everywhere it would otherwise land
-- (sm_reference_data.raw's DataSource key, and the .notes column).
--
-- Two-step discipline (same as every machine-library seed this cycle):
--   Step 1: land all 101 rows losslessly into sm_reference_data (category=
--           'material', source_region='USA'), keyed by PrimaryID, full
--           original row preserved in .raw (minus the vendor name). This is
--           the audit trail -- nothing here is "corrected".
--   Step 2: promote into the live raw_materials table under
--           material_group = 'Sheet Metal' -- a NEW group value, additive
--           only. Dedup is by exact material-string match (NOT EXISTS),
--           the same mechanical precedent used for mhr_records all cycle.
--
-- KNOWN GAP -- deliberately NOT resolved here: raw_materials already has
-- overlapping alloys under a DIFFERENT naming convention (material_group =
-- 'Ferrous & Non-Ferrous'), e.g. migration 353's 'SS304'/'AA6061-T6' short
-- names and migration 422's real, heavily-reconciled SS304 data. This
-- migration's rows use the source's own "Generic <Family>, <Grade>" naming
-- (e.g. 'Generic Stainless Steel, AISI 304'), which is a different string,
-- so the NOT EXISTS dedup will NOT catch or merge these -- both versions end
-- up live side by side, under different material_group values, and in at
-- least one case with materially different numbers (this file's AISI 304:
-- TYS 210 / UTS 564 MPa vs. migration 353's SS304: UTS 515 / YTS 205 MPa --
-- different temper/condition, not a data-entry error, but nobody has
-- verified they should be reconciled into one canonical row). Flagged for a
-- future deliberate decision, same as the still-open Standard Press
-- Direct/Indirect-OH discrepancy from migration 585-589 -- not silently
-- merged, not silently duplicated-and-ignored.
--
-- SOURCE DATA CORRECTIONS -- the sm_reference_data staging copy always keeps
-- every row exactly as the source gave it (nothing below touches Step 1).
-- The PROMOTED (raw_materials) values differ from the source for a small,
-- explicit, fully-documented set of rows (see CORRECTIONS / WHOLESALE_
-- CORRUPTED / NULL_SCRAP_FACTOR_FOR / SKIP_PROMOTION in the generator
-- script, backend/migrations/scripts/gen_590_seed_sheet_metal_raw_materials.js):
--   * 'Brass, UNS C36000' and 'Steel, AISI 4140, Medium-Carbon' had TYS >
--     UTS (physically impossible) with a transposed TYS/UTS swap resolving
--     it and landing on physically plausible numbers -- corrected by swap.
--   * 'Copper, UNS C11000' had ShearStrength_MPa literally copied from its
--     own YoungsModulus_MPa field (115000), and a TYS>UTS inversion that
--     doesn't resolve to any real reference value even swapped. Rather than
--     null these out, they are replaced with the real, published, annealed
--     C11000 (ETP copper) values this codebase already uses for the
--     identical alloy in migration 353 (UTS 220 / YTS 69 MPa, standard
--     ASM/CDA reference figures), plus the standard ASM Metals Handbook
--     shear-strength figure for annealed C11000 (150 MPa) -- looked up, not
--     derived from this row's corrupted numbers.
--   * All 6 'Copper, UNS ...' rows share ScrapPct=100, physically nonsensical
--     for a raw material input -- scrap_factor nulled for these rows only
--     (Brass's own ScrapPct=31 is untouched, it's a plausible distinct
--     value). Unlike the mechanical properties above, scrap/yield-loss rate
--     has no published standard to cite it from -- it's a shop/process
--     economics parameter, not a material constant -- so there genuinely is
--     no root-cause number available here; any figure would be invented,
--     not looked up.
--   * 'Steel, Hot Worked, ASTM A572 Grade 50' and 'Steel, Hot Worked, Grade
--     S235JR' had Hardness/HardnessSystem/TYS/UTS/ShearStrength/K/n/R values
--     that are exact duplicates of a different, unrelated alloy's row
--     ('Steel, Hot Worked, AISI 6150'), the only two rows in the whole
--     dataset using HardnessSystem='Tensile Strength' (all 99 others use
--     'Brinell'). Fields are replaced with each standard's own real,
--     citable, guaranteed values wherever the standard specifies one:
--       - A572/A572M-18 Grade 50: yield 345 MPa (50 ksi) AND tensile
--         450 MPa (65 ksi) -- BOTH are guaranteed MINIMUMS with no ceiling
--         specified, so both are usable as single numbers.
--       - EN 10025-2:2019 S235JR: yield 235 MPa (guaranteed minimum, the
--         "235" in the grade name) -- but tensile strength is a genuine
--         TWO-SIDED range in the standard itself (360-510 MPa), so left
--         NULL rather than picking an arbitrary point in it, matching
--         migration 386's SECC precedent.
--       - Neither standard specifies/certifies Hardness, shear strength, or
--         K/n/R -- no guaranteed number exists for these, left NULL (not a
--         gap in my sourcing, a gap in what the standard covers).
--     YoungsModulus_MPa (116000) and PoissonsRatio (0.34) on these two rows
--     were part of the same copy-paste corruption (not real steel values)
--     -- replaced with 207000 / 0.28, the real standard steel values (and
--     the same figures this exact dataset's own sibling "Steel, Hot Worked,
--     AISI ..." rows already use).
--   * 'Steel, Hot Worked, S900MC', 'Titanium, Ti-5Al-2.5Sn', and 'Titanium,
--     Ti-6Al-4V' are pure cost/density stubs (every other field null) --
--     skipped from promotion entirely (still staged) since they add no
--     differentiated technical data, and the Titanium pair would otherwise
--     create confusing near-empty duplicates of migration 353's own
--     fully-populated 'Ti-6Al-4V' row.
-- UnitCost_USD_kg (not BaseCostPerUnit_USD, which is corrupted on some rows)
-- is the authoritative cost figure throughout.
--
-- REVIEWED, NOT CHANGED: 'Steel, Hot Worked, AISI 1020' has TYS (455)
-- marginally above UTS (450) -- a 1.1% gap, unlike every correction above
-- (all >10%, several 2x+). Swapping would barely change the numbers and
-- there is no independent evidence this specific pair is a transposition
-- rather than ordinary rounding/reporting noise on two closely-spaced
-- values -- left as sourced rather than "corrected" on a coin flip.
--
-- MillingSpeed_m_min is 0.0 on every single row that has it populated at all
-- (never any other non-null value across all 101 rows) -- a cutting speed of
-- exactly zero is not physically meaningful, so this is treated as a
-- universal "not populated" sentinel and stored as NULL in raw_materials,
-- not as a fabricated real zero. The literal 0.0 is still preserved
-- untouched in the sm_reference_data staging copy.
--
-- New raw_materials columns (previously nonexistent, real sheet-forming
-- inputs, not fabricated): strength_coeff_k_mpa, strain_hardening_exponent_n,
-- lankford_coefficient_r, milling_speed_m_min. Reused existing columns:
-- elastic_modulus_gpa (converted from MPa to GPa), poisson_ratio, hardness,
-- hardness_system, ultimate_tensile_strength, yield_tensile_strength,
-- shearing_strength, scrap_factor (converted from ScrapPct 0-100 to a 0-1
-- fraction, matching migration 321's existing convention), density_kg_m3,
-- density (g/cm3), cost, cost_usa, currency.
-- ============================================================================

BEGIN;

-- ── New columns (real forming parameters; nullable, no fabricated defaults) ──
ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS strength_coeff_k_mpa       NUMERIC,
  ADD COLUMN IF NOT EXISTS strain_hardening_exponent_n NUMERIC,
  ADD COLUMN IF NOT EXISTS lankford_coefficient_r     NUMERIC,
  ADD COLUMN IF NOT EXISTS milling_speed_m_min        NUMERIC;

COMMENT ON COLUMN raw_materials.strength_coeff_k_mpa IS
  'Strength coefficient K (MPa) in the Hollomon power-law hardening relation sigma = K * epsilon^n. Sheet-forming/springback input.';
COMMENT ON COLUMN raw_materials.strain_hardening_exponent_n IS
  'Strain-hardening exponent n in the Hollomon power-law hardening relation sigma = K * epsilon^n. Sheet-forming/springback input.';
COMMENT ON COLUMN raw_materials.lankford_coefficient_r IS
  'Lankford (normal anisotropy) coefficient R. Deep-draw / stretch-forming formability input.';
COMMENT ON COLUMN raw_materials.milling_speed_m_min IS
  'Recommended milling cutting speed (m/min), where sourced. NULL, not 0, means not populated by the source.';

-- ── Step 1: lossless staging (audit trail; not read live by the app) ────────
INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
VALUES
${stageRows.join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

-- ── Step 2: promote to the live table, tagged as a new 'Sheet Metal' group ──
INSERT INTO raw_materials (
  material, material_grade, material_type, material_group,
  density_kg_m3, density,
  ultimate_tensile_strength, yield_tensile_strength, shearing_strength,
  hardness, hardness_system,
  elastic_modulus_gpa, poisson_ratio,
  strength_coeff_k_mpa, strain_hardening_exponent_n, lankford_coefficient_r,
  scrap_factor, milling_speed_m_min,
  cost, cost_usa, currency
)
SELECT v.material, v.material_grade, v.material_type, v.material_group,
       v.density_kg_m3, v.density,
       v.uts, v.tys, v.shear,
       v.hardness, v.hardness_system,
       v.elastic_modulus_gpa, v.poisson_ratio,
       v.k_mpa, v.n_exp, v.r_lankford,
       v.scrap_factor, v.milling_speed,
       v.cost, v.cost_usa, v.currency
FROM (VALUES
${promoteRows.join(',\n')}
) AS v(material, material_grade, material_type, material_group,
       density_kg_m3, density, uts, tys, shear, hardness, hardness_system,
       elastic_modulus_gpa, poisson_ratio, k_mpa, n_exp, r_lankford,
       scrap_factor, milling_speed, cost, cost_usa, currency)
WHERE NOT EXISTS (
  SELECT 1 FROM raw_materials rm WHERE rm.material = v.material
);

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM raw_materials WHERE material_group = 'Sheet Metal';
-- -- Expect up to 98 (101 staged rows minus 3 skipped pure cost/density stubs;
-- -- fewer still if any 'material' string collided with an existing row).
-- SELECT count(*) FROM sm_reference_data WHERE category = 'material' AND source_region = 'USA' AND source_version = '2026-08';
-- -- Expect 101.
-- SELECT material, strength_coeff_k_mpa, strain_hardening_exponent_n, lankford_coefficient_r
--   FROM raw_materials WHERE material_group = 'Sheet Metal' ORDER BY material LIMIT 20;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, 'with', data.length, 'rows staged,', (data.length - skipped), 'candidate promotions,', skipped, 'skipped (pure cost/density stubs),', corrected, 'rows corrected.');
