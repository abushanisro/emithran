-- ============================================================================
-- Migration: Sheet Metal Lookup Tables -- Burn Profile Base Charge (staging)
-- Purpose: Lands the "burnProfileBaseCharge" lookup-table export (4 rows,
--          plate thickness bracket -> flat USD base charge) into the same
--          lossless staging table earlier Lookup Tables migrations created.
--          See migration 479's header for the staging/promotion architecture.
--
--          NOT promoted -- "burn profile" is oxyfuel/plasma thick-plate
--          flame-cutting terminology (thickness range 50.8mm-25400mm, i.e.
--          2in-1000in -- the top row is a sentinel "and above" bracket, not
--          a real material thickness). Confirmed zero cost engine exists for
--          this process: bom-items.service.ts (~line 5908) explicitly cites
--          "Plasma Cutting" as an example of a process with "no registered
--          ManufacturingProcessEngine"; "Plasma Cutting"/"Oxy-Fuel Cutting"
--          exist only as user-facing equipment-type labels
--          (lib/constants/equipment-types.ts), never as a priced process.
--          Reference-only, kept for completeness.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'burnProfileBaseCharge:50.8',   '7.00',  'Currency', 'Oxyfuel/plasma thick-plate base charge by thickness bracket ($/cut) -- no cost engine exists for this process in this app', '{"plateThicknessMm": 50.8, "rateUsd": 7.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'burnProfileBaseCharge:88.9',   '7.00',  'Currency', 'Oxyfuel/plasma thick-plate base charge by thickness bracket ($/cut) -- no cost engine exists for this process in this app', '{"plateThicknessMm": 88.9, "rateUsd": 7.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'burnProfileBaseCharge:152.4',  '27.00', 'Currency', 'Oxyfuel/plasma thick-plate base charge by thickness bracket ($/cut) -- no cost engine exists for this process in this app', '{"plateThicknessMm": 152.4, "rateUsd": 27.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'burnProfileBaseCharge:25400.0','27.00', 'Currency', 'Oxyfuel/plasma thick-plate base charge -- sentinel "and above" bracket (25400mm = 1000in, not a real plate thickness), no cost engine exists for this process in this app', '{"plateThicknessMm": 25400.0, "rateUsd": 27.0}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
