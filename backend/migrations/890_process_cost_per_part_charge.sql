-- Migration 890: per-part charge lines on process_cost_records
-- Date: 2026-10-04
--
-- A process line can be a per-part charge with no machine time: die-casting
-- Melting is melted kg x the melter conversion cost per kg (memory/Die Casting
-- has no furnace melt rate), waterjet nozzle wear is a consumable allowance.
-- apply-route refused to save these lines because a saved row had to carry a
-- positive cycle time, so a die-cast route could not be applied at all.
--
-- charge_basis says how a row is costed:
--   time      setup and cycle time x machine and labour rates (every existing row)
--   per_part  no machine time; total_cost_per_part is the cost, cycle_time is NULL
--
-- cycle_time may now be NULL for per_part rows only. ck_pcr_cycle_time_positive
-- (migration 717) is unchanged; a NULL passes it, and the new check keeps every
-- time row on a real cycle time.

DO $$
BEGIN
  ALTER TABLE process_cost_records
    ADD COLUMN IF NOT EXISTS charge_basis TEXT NOT NULL DEFAULT 'time';

  ALTER TABLE process_cost_records ALTER COLUMN cycle_time DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'process_cost_records'::regclass AND conname = 'ck_pcr_charge_basis'
  ) THEN
    ALTER TABLE process_cost_records
      ADD CONSTRAINT ck_pcr_charge_basis CHECK (
        (charge_basis = 'time' AND cycle_time IS NOT NULL)
        OR (charge_basis = 'per_part' AND cycle_time IS NULL AND total_cost_per_part IS NOT NULL)
      );
    RAISE NOTICE 'Added ck_pcr_charge_basis.';
  END IF;
END $$;

COMMENT ON COLUMN process_cost_records.charge_basis IS
  'time: costed from setup and cycle time x rates. per_part: a per-part charge with no machine time (melting conversion cost, consumable allowance); total_cost_per_part is the cost and cycle_time is NULL.';
