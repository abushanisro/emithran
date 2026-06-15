-- Migration 153: Seed missing machine categories + enforce process_family vocabulary
--
-- Context: migration 152 seeded 43 benchmark MHR records for CNC turning,
-- milling, sheet metal, grinding, welding, EDM and surface treatment.
-- Three categories were missing, causing the AI to fall back to VMC for:
--
--   bench_manual   — deburring, cleaning, marking       (₹100 op → billed at VMC ₹1,850)
--   quality        — inspection bench, CMM              (₹150 op → billed at VMC ₹1,850)
--   saw            — stock cut (Op10)                   (₹250 op → billed at lathe parting)
--
-- Also adds:
--   surface_treatment vendor  — for outsourced anodize / plate (distinct from in-house line)
--   drill                     — bench drill / radial arm for simple cross-hole ops
--
-- And enforces a controlled vocabulary CHECK constraint on process_family so
-- typos ('qualities', 'inspections') cannot break AI routing silently.
--
-- Run from: Supabase SQL editor (service role — same as migration 152).
-- Safe to re-run: ALTERs use IF NOT EXISTS; INSERTs use WHERE NOT EXISTS.

-- ──────────────────────────────────────────────────────────────────────────────
-- PART A — Idempotent column guard
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS source_type    VARCHAR(20)  DEFAULT 'BENCHMARK',
  ADD COLUMN IF NOT EXISTS process_family VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS industry       VARCHAR(50)  NULL,
  ADD COLUMN IF NOT EXISTS data_version   VARCHAR(20)  DEFAULT 'FY2025-26';

-- ──────────────────────────────────────────────────────────────────────────────
-- PART B — Fix heat_treatment tag (migration 152 bug)
-- The furnace was tagged 'surface_treatment'; AI now routes them separately.
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE mhr_records
  SET process_family = 'heat_treatment'
  WHERE commodity_code = 'HEAT-TREAT'
    AND source_type    = 'BENCHMARK';

-- ──────────────────────────────────────────────────────────────────────────────
-- PART C — Enforce controlled vocabulary
--
-- All valid process_family values — covers every value in migration 152 plus
-- the new categories added here. NULL is allowed (legacy un-tagged rows keep
-- working; keyword heuristic in machine-ranker.ts handles them).
--
-- Uses exception block for idempotency because PostgreSQL has no
-- "ADD CONSTRAINT IF NOT EXISTS" syntax.
-- ──────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE mhr_records
    ADD CONSTRAINT mhr_process_family_vocab
    CHECK (
      process_family IS NULL OR process_family IN (
        -- machining (from migration 152)
        'cnc_turned',
        'cnc_milled',
        'sheet_metal',
        'grinding',
        'edm',
        'injection_moulding',
        -- joining (from migration 152)
        'welding',
        -- finishing / treatment (migration 152 + 153 fix)
        'surface_treatment',
        'heat_treatment',
        -- new in migration 153
        'bench_manual',
        'quality',
        'saw',
        'drill'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- constraint already exists, nothing to do
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- PART D — Insert missing machine records
-- All inserts are guarded by WHERE NOT EXISTS on (commodity_code, source_type).
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO mhr_records
  (machine_name, machine_description, commodity_code,
   landed_machine_cost, total_machine_hour_rate,
   currency_code, country_code, location,
   source_type, process_family, industry, data_version)

SELECT
  m.machine_name, m.machine_description, m.commodity_code,
  m.landed_machine_cost, m.total_machine_hour_rate,
  m.currency_code, m.country_code, m.location,
  m.source_type, m.process_family, m.industry, m.data_version
FROM (VALUES

  -- ── BENCH / MANUAL ──────────────────────────────────────────────────────────
  -- Deburring, edge-break, cleaning, marking, packaging.
  -- Without these the AI bills deburring at VMC rate (18× too expensive).

  ('Manual Workstation - Deburring & Cleaning',
   'Workbench with hand files, rotary deburring kit, parts washer. '
   'Deburring, edge-break, cleaning and marking operations.',
   'BENCH-DEBURR',
   50000,   100,
   'INR', 'IN', 'India',
   'BENCHMARK', 'bench_manual', 'General Manufacturing', 'FY2025-26'),

  ('Manual Workstation - Assembly & Packaging',
   'Workbench with torque tools, assembly fixtures, labelling station. '
   'Sub-assembly, kitting and final packaging.',
   'BENCH-ASSY',
   60000,   120,
   'INR', 'IN', 'India',
   'BENCHMARK', 'bench_manual', 'General Manufacturing', 'FY2025-26'),

  -- ── QUALITY / INSPECTION ─────────────────────────────────────────────────────
  -- Dimensional inspection, thread gauging, first article, final QC.
  -- Without these the AI bills inspection at VMC rate (12× too expensive).

  ('Inspection Bench (Dimensional)',
   'Granite surface plate, height gauge, micrometers, bore gauges, thread gauges. '
   'Dimensional checks, go/no-go gauging and visual inspection.',
   'INSP-BENCH',
   120000,   150,
   'INR', 'IN', 'India',
   'BENCHMARK', 'quality', 'General Manufacturing', 'FY2025-26'),

  ('CMM - Bridge Type (500×700×500 mm)',
   'CNC coordinate measuring machine. GD&T verification, position tolerance '
   'measurement, first article inspection, aerospace parts.',
   'INSP-CMM-SM',
   3500000,   650,
   'INR', 'IN', 'India',
   'BENCHMARK', 'quality', 'Aerospace, Automotive, General Manufacturing', 'FY2025-26'),

  ('CMM - Bridge Type (1000×1200×800 mm)',
   'Large-capacity CNC CMM for assemblies, housings, structural aerospace parts. '
   'Full GD&T audit capability.',
   'INSP-CMM-LG',
   8000000,  1200,
   'INR', 'IN', 'India',
   'BENCHMARK', 'quality', 'Aerospace, Defence', 'FY2025-26'),

  -- ── SAW / STOCK PREP ────────────────────────────────────────────────────────
  -- Op10 "Stock Cut" — every bar-stock part starts here.
  -- Without a saw record the AI uses VMC or lathe parting, both wrong.

  ('Vertical Band Saw (⌀300mm capacity)',
   'Vertical band saw. Bar stock, plate and structural sections up to ⌀300mm. '
   'Coolant-fed blade.',
   'SAW-BAND-SM',
   180000,   250,
   'INR', 'IN', 'India',
   'BENCHMARK', 'saw', 'General Manufacturing', 'FY2025-26'),

  ('Horizontal Band Saw (500mm capacity)',
   'Semi-automatic horizontal gravity-feed band saw with vice clamp and length stop. '
   'Batch bar cutting, heavy billets, structural steel.',
   'SAW-BAND-HORIZ',
   280000,   320,
   'INR', 'IN', 'India',
   'BENCHMARK', 'saw', 'General Manufacturing, Heavy Engineering', 'FY2025-26'),

  ('Cold Saw - Circular (⌀200mm bar)',
   'Cold circular saw. Clean burr-free cuts on bar stock to ⌀200mm. '
   'Low heat generation — aluminium, stainless and mild steel.',
   'SAW-COLD',
   120000,   200,
   'INR', 'IN', 'India',
   'BENCHMARK', 'saw', 'General Manufacturing, Aerospace', 'FY2025-26'),

  -- ── SURFACE TREATMENT VENDOR ─────────────────────────────────────────────────
  -- Represents outsourcing to an anodizing / plating sub-contractor.
  -- Distinct from the in-house Anodizing Line (SURF-ANOD) in migration 152.
  -- Rate is a placeholder throughput equivalent (actual cost is per-part; the
  -- AI should prefer the procuredParts path when surface treatment is outsourced,
  -- but this record provides a machine candidate when that path is unavailable).

  ('Surface Treatment Vendor (Outsourced)',
   'External vendor for Type II / Type III anodizing, zinc plating, passivation, '
   'black oxide. Landed cost = nominal vendor qualification / racking cost. '
   'Rate is a throughput-equivalent placeholder — use procuredPart with actual '
   'vendor quote for precise per-part costing.',
   'SURF-VENDOR',
   10000,   300,
   'INR', 'IN', 'India',
   'BENCHMARK', 'surface_treatment', 'General Manufacturing, Aerospace', 'FY2025-26'),

  -- ── DRILL PRESS ─────────────────────────────────────────────────────────────
  -- Simple cross-holes, axial holes and spot-facing that do not need a VMC.
  -- Aerospace shops often route: lathe → drill press → tap, not lathe → VMC → tap.
  -- Adds the option; AI will still choose VMC when tolerance or GD&T demands it.

  ('Bench Drill Press (13mm chuck)',
   'Benchtop drill press for simple through-holes, spot-facing and light reaming '
   'in aluminium, mild steel and plastics up to 13mm diameter.',
   'DRILL-BENCH',
   25000,    80,
   'INR', 'IN', 'India',
   'BENCHMARK', 'drill', 'General Manufacturing', 'FY2025-26'),

  ('Radial Arm Drill (50mm capacity)',
   'Radial arm drill press. Large, heavy workpieces where VMC setup is impractical. '
   'Holes up to ⌀50mm; swing arm allows positioning without re-fixturing.',
   'DRILL-RADIAL',
   350000,   380,
   'INR', 'IN', 'India',
   'BENCHMARK', 'drill', 'Heavy Engineering, General Manufacturing', 'FY2025-26')

) AS m(machine_name, machine_description, commodity_code,
        landed_machine_cost, total_machine_hour_rate,
        currency_code, country_code, location,
        source_type, process_family, industry, data_version)

WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.commodity_code = m.commodity_code
    AND r.source_type    = 'BENCHMARK'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- PART E — Verify (uncomment and run after the migration)
-- ──────────────────────────────────────────────────────────────────────────────
-- SELECT
--   COALESCE(process_family, '(untagged)') AS process_family,
--   COUNT(*)                               AS n,
--   MIN(total_machine_hour_rate)           AS rate_min,
--   MAX(total_machine_hour_rate)           AS rate_max,
--   STRING_AGG(commodity_code, ', ' ORDER BY commodity_code) AS codes
-- FROM   mhr_records
-- WHERE  source_type = 'BENCHMARK'
-- GROUP  BY process_family
-- ORDER  BY process_family;
