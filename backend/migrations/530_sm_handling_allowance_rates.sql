-- Migration: sm_handling_allowance_rates -- real material-handling cost by
--            weight bracket, promoted from staging (closeout Plan Phase 2a)
-- Purpose: Turret-punch costing had no material-handling-allowance cost line
--          at all. Real data (smTurretPressHandling export, migration 515)
--          gives 7 USD-by-weight brackets. Only Turret Press is promoted
--          here -- the other 4 process-specific curves staged alongside it
--          (Generic/Std Press, Laser/Plasma Punch) are unwired placeholder
--          operations in this app today (migration 503), so promoting their
--          rates would have no live consumer.
--
-- Architectural guardrails applied (per the closeout plan review):
--   - source_ref_id: not a strict FK (sm_reference_data uses a SERIAL id per
--     staged row, and this table is seeded from 7 distinct staged rows, one
--     per bracket) -- each row here names its own source_ref_id so the
--     provenance is a real join, not just a comment.
--   - rule_set_version: a stamped label for this batch of rates, not a full
--     versioning system.
--   - effective_from/effective_to: nullable, ready for a future rate change
--     to be added as a new row with a start date rather than an overwrite.

CREATE TABLE IF NOT EXISTS sm_handling_allowance_rates (
    id                SERIAL PRIMARY KEY,
    machine_class     TEXT NOT NULL,
    weight_kg_max     NUMERIC NOT NULL,
    allowance_usd     NUMERIC NOT NULL,
    source_ref_id     INTEGER REFERENCES sm_reference_data(id),
    rule_set_version  TEXT NOT NULL DEFAULT '2026.08',
    effective_from    DATE,
    effective_to      DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_handling_allowance_rates_class_weight
  ON sm_handling_allowance_rates(machine_class, weight_kg_max);

ALTER TABLE sm_handling_allowance_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON sm_handling_allowance_rates;
CREATE POLICY "Public read" ON sm_handling_allowance_rates FOR SELECT USING (true);

COMMENT ON TABLE sm_handling_allowance_rates IS 'Real material-handling cost (USD) by part-weight bracket, keyed by machine_class -- see turret-punch-engine.ts. Only turret_punch is populated today; see migration 530 header for why the other 4 near-identical process curves were not promoted.';

-- NOT a straight copy from staging: the source screenshot's own
-- smTurretPressHandling table has a real transcription defect -- its first
-- two brackets both read weight_kg=0.0 (staged as-is in migration 515,
-- rows with duplicate keys 'handlingAllowance:smTurretPressHandling:0.0'),
-- which collided under sm_reference_data's own unique index and silently
-- dropped one of the two rows on insert. The other 4 process-specific
-- handling tables staged in the SAME export (Generic/Std Press, Laser/
-- Plasma Punch) are byte-identical in every other value and all correctly
-- show weight_kg=1.0 for their second bracket -- cross-referencing those
-- structurally identical siblings (same precedent as the OMAX/Waterjet-
-- Cutter bed-size correction earlier this reconciliation), the second
-- bracket here is corrected to weight_kg=1.0 rather than silently shipping
-- a table missing its own second bracket.
INSERT INTO sm_handling_allowance_rates (machine_class, weight_kg_max, allowance_usd, source_ref_id) VALUES
  ('turret_punch', 0.0,         0.0,  (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:0.0')),
  ('turret_punch', 1.0,         2.0,  NULL),
  ('turret_punch', 5.0,         2.0,  (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:5.0')),
  ('turret_punch', 10.0,        4.0,  (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:10.0')),
  ('turret_punch', 27.0,        9.0,  (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:27.0')),
  ('turret_punch', 50.0,        25.0, (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:50.0')),
  ('turret_punch', 999999999.0, 46.0, (SELECT id FROM sm_reference_data WHERE category = 'lookup_table' AND key = 'handlingAllowance:smTurretPressHandling:999999999.0'))
ON CONFLICT (machine_class, weight_kg_max) DO NOTHING;

-- Verification:
-- SELECT * FROM sm_handling_allowance_rates ORDER BY weight_kg_max;
-- Should return 7 rows for machine_class='turret_punch'.
