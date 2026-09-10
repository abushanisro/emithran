-- Migration: drop the duplicate process-cost currency column
-- Description: Removes process_cost_records.currency_code, which contradicts
--              process_cost_records.currency on every row in the database and
--              which nothing reads. Keeps currency and the three provenance
--              columns added by 707. No money value changes.
-- Date: 2026-09-09

-- WHY THIS EXISTS
--
-- Exactly the defect migration 710 fixed on bom_item_costs, still present on
-- process_cost_records: two currency columns on the same row, disagreeing.
--
--   currency_code   INR   on all 507 rows
--   currency        USD   on most rows, INR on some
--
-- Measured live, one active row (fce24614, a real USA Roll Bending line):
--
--   currency_code            INR
--   currency                 USD
--   cost_currency_basis      local
--   cost_currency_local      USD
--
-- So the row simultaneously asserts it is rupees and that it is dollars, and
-- the three columns that were designed to settle the question (migration 707)
-- agree with currency, not with currency_code.
--
-- WHERE THE CONTRADICTION CAME FROM
--
-- Migration 034 creates process_cost_records.currency with DEFAULT INR -- this
-- schema was built India-first, as migration 436 documents at length.
-- Migration 436 then walked the cost-bearing tables flipping that default to
-- USD, and its target list contains the process_cost_records currency column
-- but NOT the process_cost_records currency_code column. It does list
-- currency_code for mhr_records and for lsr_records, so the omission is
-- specific to this table rather than a decision to leave currency_code columns
-- alone generally. currency_code therefore kept its India-era default, and
-- because no writer has ever set it, every row inserted since has silently
-- taken that default while the application wrote the real currency next door.
--
-- WHY DROP RATHER THAN RECONCILE
--
-- Nothing reads it. The only currency_code readers in the codebase are
--
--   bom-item-cost.service.ts          bom_item_costs.currency_code
--   retrieval.service.ts              mhr_records and lhr_records currency_code
--
-- none of which touch process_cost_records, and no frontend path reads this
-- table directly -- the UI goes through the API, which maps
-- AppliedProcessCostRecord, a type that has no currency_code field at all.
-- So the column is unread, unwritten, and wrong. Backfilling it from currency
-- would create a second maintained copy of the same fact, which is the
-- duplicated source of truth this programme exists to remove.
--
-- Same reasoning, same outcome, as migration 710: the column that goes is the
-- one that asserts a value it has no evidence for.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'process_cost_records' AND column_name = 'currency_code'
  ) THEN
    ALTER TABLE process_cost_records DROP COLUMN currency_code;
    RAISE NOTICE 'process_cost_records.currency_code dropped.';
  ELSE
    RAISE NOTICE 'process_cost_records.currency_code already absent - nothing to do.';
  END IF;
END $$;

COMMENT ON COLUMN process_cost_records.currency IS
  'ISO 4217 code this row money is denominated in. The ONLY currency column on '
  'this table - currency_code was dropped by migration 716 as an unread duplicate '
  'that contradicted this one. Read together with cost_currency_basis, '
  'cost_currency_local and cost_fx_rate_from_local (migration 707).';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'process_cost_records'
--    AND column_name LIKE '%currency%'
--  ORDER BY column_name;
-- Expect exactly four rows:
--   cost_currency_basis, cost_currency_local, cost_fx_rate_from_local, currency
