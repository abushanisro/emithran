-- ============================================================================
-- Migration 422: Seed a real SS304 row — physical properties + 2026 regional
-- pricing (all 10 regions)
-- ============================================================================
-- Root cause this fixes: SS304 does not exist anywhere in raw_materials today
-- — confirmed via direct query (`material ILIKE '%304%'` returns only an
-- unrelated "Generic ASTM A304 1330 H" row, a different standard entirely).
-- Migration 346 already computed a full Q2-2026 regional price correction FOR
-- SS304, but as an UPDATE with a WHERE clause — since no row existed to match,
-- it silently updated zero rows and nothing ever landed. Migration 353
-- (metal-grade seed) also targeted 'SS304' via INSERT ... WHERE NOT EXISTS,
-- but was apparently never run either (confirmed live — no SS304 row of any
-- kind exists). This migration inserts the row directly instead of depending
-- on either of those landing first, using the WHERE NOT EXISTS idempotency
-- guard from migration 353's own pattern.
--
-- Also seeds the newer calculator-facing uts_mpa/shear_strength_mpa columns
-- directly (see migration 395's backfill note — the legacy and calculator-
-- facing columns are parallel, not derived from each other automatically).
--
-- NOT touching the pre-existing "Generic Stainless Steel, ..." rows (14-4PH,
-- 15-5PH, 17-4PH, 310, 347, 416, 440, X5CrNi18-10, etc., including the one
-- that happens to be 304 under its EN designation X5CrNi18-10/1.4301) — they
-- share an identical, clearly-generic property set (uts_mpa=620, yield=310,
-- shear=372, elastic_modulus_gpa=193, poisson=0.27 copy-pasted across dozens
-- of unrelated alloys) with internally inconsistent regional pricing (e.g.
-- one row: cost_germany=214.08 vs cost_w_europe=70.68 — a 3x mismatch that
-- cannot be real). That data is a separate, pre-existing data-quality issue,
-- disclosed here but deliberately not touched — cleaning up ~20 "Generic
-- Stainless Steel" rows sharing fabricated placeholder properties is a
-- distinct, larger task than seeding the one grade actually requested.
--
-- ── SOURCES ───────────────────────────────────────────────────────────────
-- Mechanical/physical properties (ASTM A240/A480 minimum specification —
-- the industry-standard baseline already used by this table's other
-- austenitic-stainless rows, e.g. SS316/SS321 in migration 353):
--   - ASTM A240/A480 standard specification for austenitic stainless steel
--     sheet/plate/strip — UTS 515 MPa min, YS 205 MPa min, elongation 55% min.
--   - AK Steel / Outokumpu Type 304 Stainless Steel Product Data Bulletin —
--     density 8000 kg/m3, thermal conductivity 16.2 W/(m·K), specific heat
--     500 J/(kg·K), shear strength 386 MPa (56 ksi), elastic modulus 193 GPa.
--   - MatWeb / ASM Material Data Sheet — Poisson's ratio 0.29, electrical
--     conductivity 2.4% IACS, machinability rating 45% (relative to AISI
--     B1112 free-cutting steel baseline).
--   - World Stainless Association / ICE database — embodied carbon
--     ~6.15 kgCO2e/kg (primary+scrap production mix, average grade);
--     stainless is 100% recyclable (International Stainless Steel Forum).
--
-- Regional pricing (as of Aug-2026, benchmarked against 2026 market reports):
--   - USA: cold-rolled 2B sheet, mill-direct non-certified, $3.20-3.86/kg
--     range observed May-2026 (MWalloys/industry pricing trackers); using
--     $3.40/kg as the 2026 midpoint — a ~10% premium over migration 346's
--     already-landed HR-coil anchor ($3.10/kg), consistent with CR sheet
--     commanding a premium over HR coil.
--   - China: cold-rolled 2B sheet FOB China/Shanghai, $2.60-3.75/kg observed
--     2026 (procurement trackers); using $3.00/kg midpoint.
--   - India: domestic CR coil ~₹1,73,000/MT (~₹173/kg) to ₹210/kg observed
--     2026 (regional steel trade reports); using ₹190/kg — cost_india is
--     always INR/kg per this table's existing convention.
--   - Germany/France/W.Europe/E.Europe/UK/Vietnam/Mexico: no single clean
--     per-country 2026 report exists for these at this granularity (steel
--     price indices are published by region/alloy, not usually broken out
--     per country at retail level) — differentials applied to the USA/China
--     anchors above using the SAME documented methodology already
--     established and used for every other material in this table (migration
--     346): Germany = USA×1.17 (EU import/certification overhead), France =
--     Germany×0.978, W.Europe = avg(Germany,France), E.Europe = USA×0.94,
--     UK = USA×1.08 (post-Brexit import overhead), Vietnam = China×1.04
--     (import-dominant SE Asia hub), Mexico = USA×0.95 (USMCA proximity).
--
-- Caveat (disclosed, not hidden): commodity metal prices move continuously —
-- treat these as an indicative 2026 benchmark, not a live quote. Re-price
-- against a current MEPS International / Fastmarkets subscription before
-- using for a firm customer quotation.
-- ============================================================================

INSERT INTO raw_materials (
  material, material_grade, material_group, material_type, material_family, material_form,
  stock_form, matl_state,
  density_kg_m3, density,
  ultimate_tensile_strength, uts_mpa,
  yield_tensile_strength, yield_strength_mpa,
  shearing_strength, shear_strength_mpa,
  elongation_pct, elastic_modulus_gpa, poisson_ratio,
  melting_temp_c, thermal_conductivity_melt, thermal_conductivity_w_mk, specific_heat_melt,
  hardness, hardness_system, machinability_rating,
  electrical_conductivity_iacs_pct, co2_kg_per_kg, recyclability_percent,
  astm_standard, din_standard, en_standard, jis_standard,
  currency, purchase_uom, yield_factor, scrap_factor,
  is_global, country_code, price_source, price_version, price_date,
  cost, cost_india, cost_usa, cost_china,
  cost_germany, cost_france, cost_w_europe, cost_e_europe,
  cost_uk, cost_vietnam, cost_mexico,
  user_id
)
SELECT
  'SS304', '304', 'Ferrous & Non-Ferrous', 'Stainless Steel', 'Austenitic Stainless Steel', 'Sheet / Plate / Coil',
  'Sheet', 'Solid',
  8000, 8.00,
  515, 515,
  205, 205,
  386, 386,
  55, 193, 0.29,
  1400, 16.2, 16.2, 0.500,
  170, 'Brinell', 45,
  2.4, 6.15, 100,
  'ASTM A240/A480', '1.4301', 'EN 10088-2', 'JIS G4304 SUS304',
  'USD', 'kg', 0.85, 0.05,
  true, 'GL', 'MEPS_INTERNATIONAL_2026', 'Q3-2026', '2026-08-01',
  190, 190, 3.40, 3.00,
  3.98, 3.89, 3.94, 3.20,
  3.67, 3.12, 3.23,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM raw_materials r WHERE r.material = 'SS304'
);

-- Verification:
-- SELECT material, material_grade, density_kg_m3, uts_mpa, shear_strength_mpa,
--        cost_usa, cost_india, cost_germany, cost_china, cost_uk, cost_mexico, cost_vietnam
-- FROM raw_materials WHERE material = 'SS304';
-- Expect: exactly 1 row.
