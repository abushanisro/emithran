-- ============================================================================
-- Migration: Sheet Metal Lookup Table -- tool life (parts per tool) by
--            material type (staging)
-- Purpose: Lands the "tblToolLife" export (9 rows: material type -> number
--          of parts producible before tool replacement) into the same
--          lossless staging table earlier migrations created. See migration
--          479's header for the staging/promotion architecture. Source name
--          sanitized per the standing rule against naming the licensed
--          source -- no vendor name stored anywhere in this file or its data.
--
--          This is PUNCH/DIE tool life (wear-based tool replacement interval
--          for stamping/punching tooling), a DIFFERENT concept from the
--          CNC cutting-insert tool life this app already models
--          (manufacturing-rules/resolvers/parameter.resolver.ts's
--          toolLifeMinutes, physics-registry.ts's `Tool Life` input ->
--          toolCostPerPart). Grepped for any existing die/punch tool-life
--          or parts-per-tool concept in the turret-punch cost path
--          (turret-punch-engine.ts, sheet-metal-lookup.service.ts) -- found
--          none; this app's turret-punch costing has no tool-wear
--          amortization at all today.
--
--          Also checked the one other place a table named exactly
--          "tool_life_reference" is referenced (cost-engineering.service.ts
--          / cost-engineering.controller.ts's getToolLife) -- confirmed
--          live that this table does NOT exist in the database (query
--          error: "Could not find the table 'public.tool_life_reference'"),
--          and confirmed via repo-wide search that this entire
--          cost-engineering module has ZERO frontend consumers (no
--          references in app/, components/, or lib/) -- it is orphaned
--          scaffolding, not a real live feature. NOT the right home for
--          this data; not wired there.
--
--          Staged for completeness only -- NOT promoted or wired to any
--          calculator. Promoting this into a real turret-punch tool-wear
--          cost term would be a new capability (this app doesn't amortize
--          die wear into punch cost at all today), not a data fix -- a
--          real product decision, not made here.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Aluminum',                  '17500000', 'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Aluminum",                   "num_parts_per_tool": 17500000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Copper',                    '17500000', 'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Copper",                     "num_parts_per_tool": 17500000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Galvanized Steel',          '3000000',  'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Galvanized Steel",           "num_parts_per_tool": 3000000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Heat Resistant Super Alloys','625000',   'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Heat Resistant Super Alloys","num_parts_per_tool": 625000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Low-Alloy Steel',           '3000000',  'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Low-Alloy Steel",            "num_parts_per_tool": 3000000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Stainless Steel',           '750000',   'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Stainless Steel",            "num_parts_per_tool": 750000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Steel',                     '3000000',  'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Steel",                      "num_parts_per_tool": 3000000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Titanium',                  '100000',   'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Titanium",                   "num_parts_per_tool": 100000}'::jsonb),
('lookup_table', 'USA', '2026-03', 'toolLifePartsPerTool:Unalloyed Steel',           '3000000',  'Count', 'Parts producible per tool before replacement, by material -- no known consumer in this app yet (turret-punch costing has no tool-wear term today)', '{"material_type": "Unalloyed Steel",            "num_parts_per_tool": 3000000}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
