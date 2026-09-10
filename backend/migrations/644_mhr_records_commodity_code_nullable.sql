-- ============================================================================
-- Migration 644: mhr_records.commodity_code -> nullable
--
-- Migration 633 (Injection Molding real machine staging) hit
-- ERROR 23502: null value in column "commodity_code" violates not-null
-- constraint. gen_633_stage_injection_molding_machines.js's own header
-- already documents this as deliberate: "Deliberately left NULL, not
-- fabricated: ... commodity_code ..." -- none of the 127 real machines in
-- memory/Injection/machine/*.json carry any commodity/model-code concept,
-- and 3 of the 4 real Injection Molding machine classes (compression_
-- molding, structural_foam_molding, reaction_injection_molding) already
-- declare an empty commodityCodes array in MACHINE_REGISTRY
-- (default-rates.constants.ts) -- the domain model itself doesn't expect
-- one for these classes yet. checkMachineCapability() (machine-
-- capability.ts:236) already has an explicit `if (!commodityCode)` branch,
-- so a null value here is an already-anticipated, already-handled case at
-- the application layer -- the column's NOT NULL constraint was simply
-- stricter than the app's own domain model requires.
--
-- Inventing a fabricated per-machine or per-tier code instead (e.g.
-- guessing 'IM-SMALL'/'IM-MED'/'IM-LARGE' tonnage-tier boundaries with no
-- real cited source) was rejected -- that would silently feed
-- MACHINE_CAPABILITY_REGISTRY lookups with made-up keys.
-- ============================================================================

ALTER TABLE mhr_records ALTER COLUMN commodity_code DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
