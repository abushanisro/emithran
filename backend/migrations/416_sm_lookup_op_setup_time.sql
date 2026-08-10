-- ============================================================================
-- Migration 416: sm_lookup_op_setup_time — per-batch setup/changeover time,
-- moved from code into a real, admin-editable table.
-- ============================================================================
-- Root cause: LASER_SETUP_MIN, PRESS_BRAKE_SETUP_MIN, TAPPING_SETUP_MIN,
-- CMM_SETUP_MIN, TURRET_SETUP_MIN, WATERJET_SETUP_MIN, COUNTERBORE_SETUP_MIN,
-- COUNTERSINK_SETUP_MIN, PEM_INSERTION_SETUP_MIN, BURRING_SETUP_MIN, and
-- REAM_SETUP_MIN (default-rates.ts) were 11 separate unconditional hardcoded
-- constants, each with NO database lookup attempt at all.
--
-- Unlike cutting speed or abrasive consumption, per-batch setup/changeover
-- time (programming recall + tool/fixture load + datum alignment) is a real
-- shop-floor time-and-motion measurement, not a physical constant derivable
-- from published machine specs or material science literature — it genuinely
-- varies by shop, operator skill, and specific tooling, and the honest source
-- for a correct number is a real time study of THIS shop's own machines, not
-- a public citation. This migration therefore does not claim new research:
-- it moves the existing values as-is into a real, admin-editable table (so a
-- shop can correct them from their own floor data without a code deploy) and
-- gives the code a designated place to disclose when it's still using the
-- pre-migration default, exactly as sm_lookup_manual_stroke/sm_lookup_
-- handling_time/etc. already do for their own fallback paths.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_op_setup_time (
    id          SERIAL PRIMARY KEY,
    operation   VARCHAR(30) NOT NULL,     -- machine class / operation key (see list below)
    setup_min   NUMERIC NOT NULL,         -- per-batch setup/changeover time (min)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_op_setup_time_operation ON sm_lookup_op_setup_time(operation);

ALTER TABLE sm_lookup_op_setup_time ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON sm_lookup_op_setup_time;
CREATE POLICY "Public read" ON sm_lookup_op_setup_time FOR SELECT USING (true);

COMMENT ON TABLE sm_lookup_op_setup_time IS 'Per-batch setup/changeover time (min) by operation — engineering defaults migrated as-is from code constants (migration 416); real values are shop-specific time-study data, editable here without a deploy';

INSERT INTO sm_lookup_op_setup_time (operation, setup_min) VALUES
  ('fiber_laser',   15),
  ('press_brake',   20),
  ('tapping',       10),
  ('cmm',           15),
  ('turret_punch',  45),
  ('waterjet',      30),
  ('counterbore',    5),
  ('countersink',    5),
  ('pem_insertion',  5),
  ('burring',        5),
  ('ream',           8)
ON CONFLICT (operation) DO NOTHING;

-- Verification:
-- SELECT operation, setup_min FROM sm_lookup_op_setup_time ORDER BY operation;
-- Should return 11 rows.
