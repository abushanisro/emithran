-- ============================================================================
-- Migration: Sheet Metal Lookup Table -- allowance_g_weight_kg (staging)
-- Purpose: Lands the "allowance_weight_data" export (6 rows) into the same
--          lossless staging table earlier migrations created. See migration
--          479's header for the staging/promotion architecture.
--
--          Shape: a weight-bracket table, NOT a linear ratio -- allowance_g
--          (grams) by weight_kg upper-bound bracket: <=5kg -> 5g,
--          <=8kg -> 11g, <=10kg -> 16g, <=27kg -> 40g, then 65g for
--          everything above (the source's own weight_kg=1000000 row is a
--          practical "no upper limit" sentinel for the top bracket, not a
--          real 1000-tonne threshold).
--
--          Grepped this entire codebase for any existing "allowance" concept
--          that operates on grams-by-weight-bracket -- found none. Every
--          existing "*allowance*" constant in this app is a LENGTH allowance
--          (mm) for edge/kerf/stock/tooling margins (EDGE_ALLOWANCE_MM,
--          CNC_STOCK_ALLOWANCE_PER_SIDE_MM, BAR_LENGTH_ALLOWANCE_MM,
--          computePartAllowanceMm, injection-molding runner allowance) --
--          none are weight-keyed or gram-valued. No packaging/logistics
--          weight-tolerance concept either. Staged for completeness only --
--          NOT promoted or wired to any calculator; what real-world
--          allowance this curve is meant to control (a scale/measurement
--          tolerance? a scrap/rounding allowance for very light parts?) is
--          not yet established against this app's own domain.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:0',       '0.0',  'Mass',    'Allowance (g) for parts up to 0 kg (the source''s own origin point) -- no known consumer in this app yet', '{"weight_kg_max": 0.0,  "allowance_g": 0.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:5',       '5.0',  'Mass',    'Allowance (g) for parts up to 5 kg -- no known consumer in this app yet',   '{"weight_kg_max": 5.0,  "allowance_g": 5.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:8',       '11.0', 'Mass',    'Allowance (g) for parts up to 8 kg -- no known consumer in this app yet',   '{"weight_kg_max": 8.0,  "allowance_g": 11.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:10',      '16.0', 'Mass',    'Allowance (g) for parts up to 10 kg -- no known consumer in this app yet',  '{"weight_kg_max": 10.0, "allowance_g": 16.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:27',      '40.0', 'Mass',    'Allowance (g) for parts up to 27 kg -- no known consumer in this app yet',  '{"weight_kg_max": 27.0, "allowance_g": 40.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'allowanceWeightBracket:unbounded','65.0','Mass',    'Allowance (g) for parts above 27 kg (source''s own weight_kg=1000000 sentinel treated as "no upper limit") -- no known consumer in this app yet', '{"weight_kg_max": null, "allowance_g": 65.0, "source_sentinel_weight_kg": 1000000.0}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
