-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 436: Default currency is USD, not INR — column-level fix
-- (2026-08-08, revised: made every ALTER existence-guarded after
-- `ALTER TABLE boms ALTER COLUMN currency SET DEFAULT 'USD'` failed live with
-- `42703: column "currency" of relation "boms" does not exist` — proof the
-- historical migration files (061/062 both claim to ADD COLUMN currency to
-- boms) do NOT reliably describe this live database's actual schema. Every
-- statement below now checks information_schema first and skips silently —
-- logging what it skipped — rather than assuming any table/column exists
-- just because an old migration file said it would add one.)
--
-- ROOT CAUSE (full trace, see accompanying report):
-- This app's schema was built India-first (early migrations like
-- 061_improve_bom_cost_system_inr.sql, database/migrations/150_currency_
-- architecture.sql's own column comments — "Default INR", "Always INR for
-- now" — document this as a deliberate, but never-revisited, MVP choice).
-- Every cost-bearing table below got its `currency`/`currency_code` column
-- with `DEFAULT 'INR'` baked in at CREATE TABLE / ADD COLUMN time. Application
-- code (mhr.service.ts, resolveSurfaceTreatmentDbRate, etc.) explicitly sets
-- currency on every INSERT it performs, so this default is invisible on the
-- app's normal, happy-path create flow — but it is NOT invisible the moment
-- any INSERT omits the column: a raw SQL seed/migration (exactly how the
-- hole_forming rows fixed by migration 434 and the Vietnam waterjet row
-- fixed by migration 435 went wrong), a bulk import, a future endpoint that
-- forgets to set it, or a partial-column UPSERT. Every one of those silently
-- gets 'INR' from the column itself, with no application code ever making
-- that choice. This migration removes that hidden fallback at its source —
-- ALTER COLUMN ... SET DEFAULT is non-destructive (it only changes what a
-- FUTURE bare INSERT gets; it does not touch any existing row's stored
-- value), so this is safe to run against a live, populated database.
--
-- This does NOT change what currency any EXISTING row is denominated in, and
-- does NOT change any location's real assigned currency (India-based MHR
-- rows are still correctly INR — see getCurrencyForLocation(), which already
-- defaults to USD only for UNRECOGNIZED locations, and was never part of this
-- bug). It only changes what a bare, column-omitting INSERT defaults to.
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  targets text[][] := ARRAY[
    ARRAY['process_cost_records', 'currency'],
    ARRAY['tooling_cost_records', 'currency'],
    ARRAY['child_part_cost_records', 'currency'],
    ARRAY['procured_parts_cost_records', 'currency'],
    ARRAY['supplier_evaluation_rfq_responses', 'currency'],
    ARRAY['boms', 'currency'],
    ARRAY['vendor_quotes', 'currency'],
    ARRAY['raw_materials', 'currency'],
    ARRAY['enhanced_raw_materials', 'currency'],
    ARRAY['mhr_records', 'currency'],
    ARRAY['mhr_records', 'currency_code'],
    ARRAY['lsr_records', 'currency'],
    ARRAY['lsr_records', 'currency_code'],
    ARRAY['process_plan_generations', 'costing_currency']
  ];
  t text;
  c text;
  current_default text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    t := targets[i][1];
    c := targets[i][2];

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = c
    ) THEN
      RAISE NOTICE 'Skipped %.% — column does not exist on this database.', t, c;
      CONTINUE;
    END IF;

    SELECT column_default INTO current_default
    FROM information_schema.columns
    WHERE table_name = t AND column_name = c;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %L', t, c, 'USD');
    RAISE NOTICE '%.%: default changed from % to ''USD''.', t, c, current_default;
  END LOOP;
END $$;

-- ── NOT changed here, deliberately — needs its own follow-up, not a column
--    default flip ──────────────────────────────────────────────────────────────
-- process_plan_generations.costing_currency's OWN column comment (migration
-- 150) says "Target currency for all cost lines in this generation. Always
-- INR for now." — this is a CODE-level behavior (the AI process-plan-
-- generator's persistence.service.ts always writes INR-denominated cost
-- lines, regardless of this column's default), not just a schema default.
-- Flipping the column default here does not make the generator itself emit
-- USD — that requires threading a real target-currency choice through
-- resolver.service.ts / persistence.service.ts, a separate, larger change
-- (tracked as its own task, not bundled in here).

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT table_name, column_name, column_default
-- FROM information_schema.columns
-- WHERE column_name IN ('currency', 'currency_code', 'costing_currency')
-- ORDER BY table_name;
-- Expect every EXISTING row's column_default = 'USD'::character varying (or
-- similar) — check the migration's own RAISE NOTICE output for which
-- table/column pairs were skipped as nonexistent on THIS database.
