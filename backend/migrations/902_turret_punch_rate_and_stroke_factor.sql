-- ============================================================================
-- Migration 902: Turret Press punch rate and the stroke rate factor lookup
-- Purpose: Turret Punching could not price punched holes because the staged
--          per-machine rows carried only nibble data. The punch rate IS in the
--          reference data: the Countries data export (14 files, identical
--          values in every file) lists punchRate for all 21 Turret Press
--          machines. The machine library export lacked that column.
--          Also stages Lookup Table 1 (stroke rate factor by machine tonnage
--          and part complexity), which the TPP calculator multiplies into the
--          machine stroke rate: effective rate = punch rate x factor.
-- Sources: memory/Countries data/*_XML_Data_.csv (Turret Press, punchRate);
--          memory/Sheetmetal/Lookup_Table_1_Stroke_Rate_Automatic_Machineseg.md;
--          memory/Sheetmetal/TPP_Calculator.md (cycle time formula).
-- Not applied: the punchRateDial variable (0.5), whose scope is not stated.
-- Run once in the SQL editor. Aborts if any machine row is missing.
-- ============================================================================
DO $$
DECLARE
  matched INT;
BEGIN
  WITH src(name, punch_rate) AS (VALUES
    ('Amada EM-3510 ZRB', 500),
    ('Amada EM-3510 ZRT', 500),
    ('Amada EM-3612 ZRB', 500),
    ('Amada EM-3612 ZRT', 500),
    ('Amada Vipros 2510 King', 280),
    ('Amada Vipros 255', 280),
    ('Amada Vipros 357 Queen', 240),
    ('Amada Vipros 358 King II', 240),
    ('Default Turret Press', 240),
    ('Finn-Power F Series', 240),
    ('Grand International CP1250', 240),
    ('Grand International CP1500', 240),
    ('Grand International CP2500', 240),
    ('Grand International HP2500', 240),
    ('Nisshinbo HIQ-1250/30H', 240),
    ('Nisshinbo HIQ-2044', 240),
    ('Nisshinbo HTP-1000', 240),
    ('Nisshinbo HTP-650', 240),
    ('Turret Press - 4.5mm Steel, 6mm Aluminum Max Thickness', 240),
    ('Turret Press - 6mm Steel, 8mm Aluminum Max Thickness', 240),
    ('Turret Press - 8mm Steel, 10mm Aluminum Max Thickness', 240)
  ), upd AS (
    UPDATE sm_reference_data d
       SET raw = d.raw || jsonb_build_object('punch_rate_cycles_min', s.punch_rate)
      FROM src s
     WHERE d.category = 'machine'
       AND d.key = 'turretPunchMachine:' || s.name
    RETURNING 1
  )
  SELECT count(*) INTO matched FROM upd;

  IF matched <> 21 THEN
    RAISE EXCEPTION 'Expected 21 turretPunchMachine rows, updated %', matched;
  END IF;
END $$;


INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:10', NULL, NULL, 'Stroke rate factor for a 10 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 10, "simple": 0.8, "intermediate": 0.64, "complex": 0.56}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:20', NULL, NULL, 'Stroke rate factor for a 20 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 20, "simple": 0.79, "intermediate": 0.63, "complex": 0.55}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:30', NULL, NULL, 'Stroke rate factor for a 30 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 30, "simple": 0.78, "intermediate": 0.62, "complex": 0.55}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:50', NULL, NULL, 'Stroke rate factor for a 50 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 50, "simple": 0.77, "intermediate": 0.62, "complex": 0.54}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:80', NULL, NULL, 'Stroke rate factor for a 80 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 80, "simple": 0.76, "intermediate": 0.61, "complex": 0.53}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:100', NULL, NULL, 'Stroke rate factor for a 100 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 100, "simple": 0.75, "intermediate": 0.6, "complex": 0.53}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:150', NULL, NULL, 'Stroke rate factor for a 150 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 150, "simple": 0.74, "intermediate": 0.59, "complex": 0.52}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:200', NULL, NULL, 'Stroke rate factor for a 200 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 200, "simple": 0.73, "intermediate": 0.58, "complex": 0.51}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:250', NULL, NULL, 'Stroke rate factor for a 250 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 250, "simple": 0.72, "intermediate": 0.58, "complex": 0.5}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:300', NULL, NULL, 'Stroke rate factor for a 300 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 300, "simple": 0.71, "intermediate": 0.57, "complex": 0.5}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:350', NULL, NULL, 'Stroke rate factor for a 350 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 350, "simple": 0.7, "intermediate": 0.56, "complex": 0.49}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:400', NULL, NULL, 'Stroke rate factor for a 400 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 400, "simple": 0.69, "intermediate": 0.55, "complex": 0.48}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:500', NULL, NULL, 'Stroke rate factor for a 500 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 500, "simple": 0.68, "intermediate": 0.54, "complex": 0.48}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:800', NULL, NULL, 'Stroke rate factor for a 800 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 800, "simple": 0.67, "intermediate": 0.54, "complex": 0.47}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:1000', NULL, NULL, 'Stroke rate factor for a 1000 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 1000, "simple": 0.66, "intermediate": 0.53, "complex": 0.46}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:1500', NULL, NULL, 'Stroke rate factor for a 1500 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 1500, "simple": 0.65, "intermediate": 0.52, "complex": 0.46}'::jsonb),
('lookup_table', 'USA', '2026-03', 'strokeRateFactor:2000', NULL, NULL, 'Stroke rate factor for a 2000 t automatic machine; multiplied into the machine stroke rate by part complexity (Lookup Table 1)', '{"tonnage_t": 2000, "simple": 0.64, "intermediate": 0.51, "complex": 0.45}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO UPDATE SET raw = EXCLUDED.raw, notes = EXCLUDED.notes;
