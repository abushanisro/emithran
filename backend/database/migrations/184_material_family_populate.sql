-- Migration 184: Populate raw_materials.material_family
--
-- The scope-classifier, retrieval service, and deterministic planner previously
-- used hard-coded regex to detect material families (polymer vs ferrous vs Al).
-- This migration populates the existing `material_family` column in raw_materials
-- so classification is data-driven — adding a new grade or polymer only requires
-- a DB row, not a code deployment.
--
-- Values written:
--   polymer_thermoplastic — ABS, PP, PC, POM, PA6/66, PEEK, HDPE, PTFE, etc.
--   polymer_thermoset     — Epoxy, phenolic, BMC, etc.
--   elastomer             — NR, EPDM, NBR, Silicone
--   ferrous_mild_steel    — IS2062, CRCA, S235, Mild Steel, MS
--   ferrous_alloy_steel   — EN8, 4140, 4340, H13, P20, D2
--   ferrous_stainless     — SS304, SS316, 17-4PH, 2205
--   ferrous_cast_iron     — GG25, EN-GJL, ductile iron
--   non_ferrous_aluminum  — Al 6061, 7075, 5052, A380, A356
--   non_ferrous_copper    — Copper, Brass, Bronze
--   non_ferrous_titanium  — Ti-6Al-4V, Ti Grade 2
--   superalloy            — Inconel, Waspaloy, Hastelloy
--
-- Safe to re-run: all UPDATEs are guarded by WHERE material_family IS NULL
-- (or WHERE material_family IN ('...') for reclassification corrections).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Polymers / Thermoplastics ────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'polymer_thermoplastic'
 WHERE material_family IS NULL
   AND (
     material_group ILIKE '%plastic%'
     OR material_group ILIKE '%polymer%'
     OR material ILIKE '%ABS%'
     OR material ILIKE '%Nylon%'
     OR material ILIKE '%Polyamide%'
     OR material ILIKE '%Polycarbonate%'
     OR material ILIKE '%Polypropylene%'
     OR material ILIKE '%POM%'
     OR material ILIKE '%Acetal%'
     OR material ILIKE '%PEEK%'
     OR material ILIKE '%HDPE%'
     OR material ILIKE '%LDPE%'
     OR material ILIKE '%PTFE%'
     OR material ILIKE '%Polysulfone%'
     OR material ILIKE '%PET%'
     OR material ILIKE '%TPE%'
     OR material ILIKE '%TPU%'
     OR material ILIKE '%Thermoforming%'
     OR material_grade ILIKE '%PA6%'
     OR material_grade ILIKE '%PA66%'
     OR material_grade ILIKE '%ABS%'
     OR material_grade ILIKE '%PP %'
     OR material_grade ILIKE '% PP'
     OR material_grade ILIKE '%PEEK%'
     OR material_grade ILIKE '%POM-%'
     OR material_grade ILIKE '%PC%'
   );

-- ── 2. Elastomers / Rubbers ─────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'elastomer'
 WHERE material_family IS NULL
   AND (
     material_group ILIKE '%rubber%'
     OR material_group ILIKE '%elastomer%'
     OR material ILIKE '%Rubber%'
     OR material ILIKE '%Silicone%'
     OR material ILIKE '%EPDM%'
     OR material ILIKE '%NBR%'
     OR material ILIKE '%Nitrile%'
     OR material ILIKE '%Natural Rubber%'
     OR material ILIKE '%VMQ%'
   );

-- ── 3. Superalloys ───────────────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'superalloy'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Inconel%'
     OR material ILIKE '%Waspaloy%'
     OR material ILIKE '%Hastelloy%'
     OR material ILIKE '%Nimonic%'
     OR material_grade ILIKE '%IN718%'
     OR material_grade ILIKE '%IN625%'
     OR material_grade ILIKE '%C-276%'
   );

-- ── 4. Non-Ferrous: Titanium ─────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'non_ferrous_titanium'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Titanium%'
     OR material ILIKE '%Ti-%'
     OR material ILIKE '%Ti 6Al%'
     OR material_grade ILIKE '%Ti-6Al-4V%'
     OR material_grade ILIKE '%Gr5%'
     OR material_grade ILIKE '%Gr2%'
   );

-- ── 5. Non-Ferrous: Copper / Brass / Bronze ──────────────────────────────────
UPDATE raw_materials
   SET material_family = 'non_ferrous_copper'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Copper%'
     OR material ILIKE '%Brass%'
     OR material ILIKE '%Bronze%'
     OR material ILIKE '%CuZn%'
     OR material ILIKE '%CuSn%'
     OR material_group ILIKE '%copper%'
     OR material_grade ILIKE '%C101%'
     OR material_grade ILIKE '%C260%'
     OR material_grade ILIKE '%CuBe%'
   );

-- ── 6. Non-Ferrous: Aluminium ────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'non_ferrous_aluminum'
 WHERE material_family IS NULL
   AND (
     material_group ILIKE '%alumin%'
     OR material ILIKE '%Alumin%'
     OR material ILIKE '%Al 6061%'
     OR material ILIKE '%Al 7075%'
     OR material ILIKE '%Al 5052%'
     OR material ILIKE '%Al 2024%'
     OR material ILIKE '%Al A380%'
     OR material ILIKE '%Al A356%'
     OR material_grade ILIKE '%6061%'
     OR material_grade ILIKE '%7075%'
     OR material_grade ILIKE '%5052%'
     OR material_grade ILIKE '%2024%'
     OR material_grade ILIKE '%A380%'
     OR material_grade ILIKE '%A356%'
     OR material_grade ILIKE '%AA%'
     OR material_grade ILIKE '%LM6%'
   );

-- ── 7. Ferrous: Cast Iron ────────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'ferrous_cast_iron'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Cast Iron%'
     OR material ILIKE '%Grey Iron%'
     OR material ILIKE '%Ductile Iron%'
     OR material ILIKE '%SG Iron%'
     OR material_grade ILIKE '%GG25%'
     OR material_grade ILIKE '%GG30%'
     OR material_grade ILIKE '%EN-GJL%'
     OR material_grade ILIKE '%EN-GJS%'
     OR material_grade ILIKE '%GJS%'
   );

-- ── 8. Ferrous: Stainless ────────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'ferrous_stainless'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Stainless%'
     OR material ILIKE '%INOX%'
     OR material ILIKE '%17-4PH%'
     OR material ILIKE '%Duplex%'
     OR material_grade ILIKE '%SS304%'
     OR material_grade ILIKE '%SS316%'
     OR material_grade ILIKE '%304%'
     OR material_grade ILIKE '%316%'
     OR material_grade ILIKE '%316L%'
     OR material_grade ILIKE '%2205%'
     OR material_grade ILIKE '%17-4%'
   );

-- ── 9. Ferrous: Alloy Steel ──────────────────────────────────────────────────
UPDATE raw_materials
   SET material_family = 'ferrous_alloy_steel'
 WHERE material_family IS NULL
   AND (
     material ILIKE '%Alloy Steel%'
     OR material ILIKE '%Tool Steel%'
     OR material_grade ILIKE '%EN8%'
     OR material_grade ILIKE '%EN24%'
     OR material_grade ILIKE '%EN36%'
     OR material_grade ILIKE '%4140%'
     OR material_grade ILIKE '%4340%'
     OR material_grade ILIKE '%H13%'
     OR material_grade ILIKE '%P20%'
     OR material_grade ILIKE '%D2%'
     OR material_grade ILIKE '%EN31%'
     OR material_group ILIKE '%alloy steel%'
     OR material_group ILIKE '%tool steel%'
   );

-- ── 10. Ferrous: Mild / Carbon Steel (broadest catch-all for ferrous) ────────
UPDATE raw_materials
   SET material_family = 'ferrous_mild_steel'
 WHERE material_family IS NULL
   AND (
     material_group ILIKE '%ferrous%'
     OR material_group ILIKE '%carbon steel%'
     OR material ILIKE '%Mild Steel%'
     OR material ILIKE '%MS Sheet%'
     OR material ILIKE '%MS Tube%'
     OR material_grade ILIKE '%IS2062%'
     OR material_grade ILIKE '%IS 2062%'
     OR material_grade ILIKE '%CRCA%'
     OR material_grade ILIKE '%S235%'
     OR material_grade ILIKE '%S275%'
     OR material_grade ILIKE '%S355%'
     OR material_grade ILIKE '%A36%'
     OR material_grade ILIKE '%DC01%'
     OR material_grade ILIKE '%EN1A%'
     OR material_grade ILIKE '%E250%'
     OR material_grade ILIKE '%E350%'
   );

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r_total    INTEGER;
  r_filled   INTEGER;
  r_null     INTEGER;
BEGIN
  SELECT COUNT(*) INTO r_total  FROM raw_materials;
  SELECT COUNT(*) INTO r_filled FROM raw_materials WHERE material_family IS NOT NULL;
  SELECT COUNT(*) INTO r_null   FROM raw_materials WHERE material_family IS NULL;
  RAISE NOTICE '=== Migration 184 — material_family populate ===';
  RAISE NOTICE 'Total raw_materials rows: %',       r_total;
  RAISE NOTICE 'Rows with material_family:  % / %', r_filled, r_total;
  RAISE NOTICE 'Rows still NULL:            %',      r_null;
  RAISE NOTICE '================================================';
END $$;
