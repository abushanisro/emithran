-- ============================================================================
-- Migration 604: 2-Axis Router real cost engine — lookup table + activation
--
-- Track B Phase 2 (2026-08-30): promotes memory/sheetmetal/lookuptable/
-- tblRouterUtilities.json's 8 real rows (the ONLY real router feed/speed data
-- on file — Aluminum/Copper only, no Steel/Stainless coverage exists anywhere
-- in the source) into a proper sm_lookup_router_cut table, mirroring
-- sm_lookup_waterjet_cut's shape/convention (migration 398). Consumed by
-- SheetMetalLookupService.getRouterParams() -> RouterEngine
-- (backend/src/modules/bom-items/costing/router-engine.ts).
--
-- Also activates the existing "2 Axis Router" process_calculator_mappings
-- row (staged inactive by migration 503, explicitly left inactive by
-- migration 533 with the note "CANNOT be activated ... without inventing
-- data ... no real sibling value anywhere to reuse"). That's no longer true:
-- a real, implemented, verified cost engine now exists for machine_class
-- 'router_2axis' (default-rates.ts's MACHINE_REGISTRY, machine-selection/
-- seed-registry.ts's MACHINE_CLASS_DEFAULTS, manufacturing-process-registry.ts).
-- This is exactly the "new work, not a bug fix" scenario migration 533's own
-- footer anticipated for this row — not a fabricated value.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_router_cut (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_family TEXT NOT NULL,       -- 'Aluminum' | 'Copper' — verbatim from tblRouterUtilities.json (American spelling; no Steel/Stainless data exists in the source)
  tool_diameter_mm NUMERIC(6, 2) NOT NULL,
  feed_per_tooth_mm NUMERIC(8, 4) NOT NULL,
  cutting_speed_m_per_min NUMERIC(8, 2) NOT NULL,
  data_source TEXT NOT NULL DEFAULT 'tblRouterUtilities.json (memory/sheetmetal/lookuptable)',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(material_family, tool_diameter_mm)
);

COMMENT ON TABLE sm_lookup_router_cut IS
  'Real 2-Axis Router feed/speed data (tblRouterUtilities.json) keyed by material_family + tool_diameter_mm. Consumed by SheetMetalLookupService.getRouterParams(). Only Aluminum/Copper have real data — a request for any other material family returns dataFound:false, never a fabricated value.';

-- 8 real rows, verbatim from tblRouterUtilities.json.
INSERT INTO sm_lookup_router_cut (material_family, tool_diameter_mm, feed_per_tooth_mm, cutting_speed_m_per_min)
VALUES
  ('Aluminum', 3.0,  0.0254, 350.52),
  ('Copper',   3.0,  0.0254, 350.52),
  ('Aluminum', 6.0,  0.0508, 350.52),
  ('Copper',   6.0,  0.0508, 350.52),
  ('Copper',   10.0, 0.0635, 350.52),
  ('Aluminum', 10.0, 0.0762, 350.52),
  ('Copper',   12.0, 0.0762, 350.52),
  ('Aluminum', 12.0, 0.1016, 350.52)
ON CONFLICT (material_family, tool_diameter_mm) DO NOTHING;

-- Activate the real, now-implemented "2 Axis Router" operation.
UPDATE process_calculator_mappings
SET machine_class = 'router_2axis', is_active = true, updated_at = NOW()
WHERE process_group = 'Sheet Metal' AND process_route = 'Cutting' AND operation = '2 Axis Router'
  AND machine_class IS NULL; -- idempotent guard, matches this repo's other activation migrations

-- Verification:
-- SELECT material_family, tool_diameter_mm, feed_per_tooth_mm, cutting_speed_m_per_min FROM sm_lookup_router_cut ORDER BY material_family, tool_diameter_mm;
-- Expect 8 rows.
-- SELECT process_group, process_route, operation, is_active, machine_class FROM process_calculator_mappings WHERE operation = '2 Axis Router';
-- Expect is_active=true, machine_class='router_2axis'.
