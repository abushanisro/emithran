-- Migration: make the costing currency contract explicit (P1a)
-- Description: Adds the currency representation that both the BOM rollup and
--              process_cost_records were missing, and enforces the invariant
--              that keeps the rollup correct. No stored money value changes.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- Audit finding RC-2: money crosses the currency boundary twice. The engines
-- compute in the factory LOCAL currency; normalizeRouteComparisonToCurrency
-- converts a route response to the DISPLAY currency; applyRoute then hands
-- those already-converted lines to writeProcessLinesAsRecords, which stamped
-- currency = 'USD' unconditionally. applyPersistedRouteToSummary later overlays
-- those persisted rows into a still-LOCAL cost summary, and
-- normalizeCostSummaryToCurrency converts the mixture again -- so the overlaid
-- core operations were divided by the FX rate a second time (measured 83.500 on
-- a real India-location part, exactly 1 / toUsdRate).
--
-- The target contract is that persistence stores LOCAL currency. That cannot be
-- switched on in one step, because total_cost_per_part has a SECOND consumer
-- with the opposite requirement:
--
--   applyPersistedRouteToSummary      needs LOCAL   (it feeds a local summary)
--   sync_process_cost_to_bom_item ->  needs USD     (bom_item_costs sits beside
--     bom_item_costs.process_cost                    raw_material_cost,
--                                                    packaging, procured and
--                                                    tooling, all USD-native)
--
-- bom_item_costs has no currency column at all -- verified across every
-- migration that touches it (035, 036 x2, 037, 041, 062, 311, 315, 547, 548,
-- 549, 999). It is read live by bom-item-cost.service.ts, boms.service.ts and
-- projects.service.ts, so writing LOCAL money into total_cost_per_part today
-- would push (for example) INR into BOM-level and project-level totals through
-- a currency-blind SQL trigger. That would be a strictly larger financial
-- defect than the one being fixed.
--
-- A BOM can also contain items from factories in different countries, so the
-- rollup aggregate genuinely cannot be "local" -- it needs ONE comparable
-- reporting currency. USD is what it already is. This migration makes that
-- explicit rather than assumed, marks the existing process rows as what they
-- actually are (unverified, written before the contract existed), and adds a
-- CHECK that makes the unsafe intermediate state impossible to reach.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not replace sync_process_cost_to_bom_item. That function drifted from
-- its own migration files: 035 and 037 both assign
-- process_cost = COALESCE(NEW.total_cost_per_part, 0) per row, while the LIVE
-- function sums the active generation (verified behaviourally in migration 706).
-- Both files are CREATE OR REPLACE, so re-running either would overwrite the
-- correct live function with the broken assignment form. Teaching the rollup
-- about currency is P1b and needs the live definition captured first.
--
-- It does not add an fx_snapshot_id foreign key. Migration 472 documents
-- fx_rate_snapshots as a per-day request-time CACHE, explicitly not the
-- authority for a resolved scenario rate (the scenario embeds the resolved rate
-- itself). Pointing a historical quote at an evictable cache row would make
-- that quote unreproducible. The resolved rate and the currency it came from
-- are persisted directly instead, which is the same provenance without the
-- dangling reference.

-- 1. The rollup aggregate declares its reporting currency

ALTER TABLE bom_item_costs
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN bom_item_costs.currency IS
  'Reporting currency for every money column on this row. USD by default and in practice: a BOM can span factories in different countries, so this aggregate cannot be denominated in any single factory local currency. Every writer -- the four sync_*_to_bom_item triggers and bom-item-cost.service.ts -- must supply values already in this currency. Added by migration 707 to replace an undocumented assumption with data.';

-- 2. process_cost_records declares what its money actually is

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS cost_currency_basis     text,
  ADD COLUMN IF NOT EXISTS cost_currency_local     varchar(3),
  ADD COLUMN IF NOT EXISTS cost_fx_rate_from_local numeric(18, 8);

-- Existing rows are marked for what they verifiably are: written before this
-- contract existed, so their denomination cannot be established from the row
-- itself. They are NOT relabelled as local, and NOT converted. A reader that
-- needs certainty must treat them as unverified.
--
-- Measured after applying this migration, which is why blanket-trusting the
-- currency column would have been wrong in BOTH directions: of 507 rows, 482
-- say USD and 25 say INR. The 25 are real rupees -- machine_rate 689 to 35,566
-- against 0.06 to 19 on the USD rows at the same location -- with location
-- NULL and no notes tag, so they predate the route-apply writer and came from
-- the manual process-cost path, not from the hardcoded USD literal at all.
-- One of them is active with a real total (603.841886) and is being summed
-- into bom_item_costs.process_cost as though it were dollars. That is a
-- pre-existing defect this labelling exposes rather than causes, and it is
-- reported separately: correcting production BOM data is not this migration
-- job.
UPDATE process_cost_records
   SET cost_currency_basis = 'legacy_unverified'
 WHERE cost_currency_basis IS NULL;

ALTER TABLE process_cost_records
  ALTER COLUMN cost_currency_basis SET DEFAULT 'legacy_unverified';

ALTER TABLE process_cost_records
  ALTER COLUMN cost_currency_basis SET NOT NULL;

-- The default is the UNTRUSTED value on purpose: a future writer that forgets
-- to set this produces a row that readers refuse to interpret, rather than one
-- silently treated as local money.
ALTER TABLE process_cost_records
  DROP CONSTRAINT IF EXISTS ck_process_cost_records_cost_currency_basis;

ALTER TABLE process_cost_records
  ADD CONSTRAINT ck_process_cost_records_cost_currency_basis
  CHECK (cost_currency_basis IN ('legacy_unverified', 'converted', 'local'));

-- A converted row must be able to describe its own conversion, and a local row
-- must actually agree with the local currency it claims. Without these, the
-- basis column would be a label a writer could set without the data to back it
-- -- exactly the kind of assumption this migration exists to remove.
ALTER TABLE process_cost_records
  DROP CONSTRAINT IF EXISTS ck_process_cost_records_converted_is_traceable;

ALTER TABLE process_cost_records
  ADD CONSTRAINT ck_process_cost_records_converted_is_traceable
  CHECK (
    cost_currency_basis <> 'converted'
    OR (cost_currency_local IS NOT NULL AND cost_fx_rate_from_local IS NOT NULL)
  );

ALTER TABLE process_cost_records
  DROP CONSTRAINT IF EXISTS ck_process_cost_records_local_agrees;

ALTER TABLE process_cost_records
  ADD CONSTRAINT ck_process_cost_records_local_agrees
  CHECK (
    cost_currency_basis <> 'local'
    OR (cost_currency_local IS NOT NULL AND currency = cost_currency_local)
  );

-- 3. The sequencing gate
--
-- Until the rollup understands currency (P1b), a row may only declare
-- local-basis money while that money is USD. This is what makes it impossible
-- to complete half of P1 and corrupt every BOM total: an attempt to persist
-- local INR before the rollup is ready fails loudly at the database instead of
-- flowing into bom_item_costs. P1b drops this constraint in the same migration
-- that teaches the rollup, so the two can never be out of step.
ALTER TABLE process_cost_records
  DROP CONSTRAINT IF EXISTS ck_process_cost_records_rollup_usd_until_p1b;

ALTER TABLE process_cost_records
  ADD CONSTRAINT ck_process_cost_records_rollup_usd_until_p1b
  CHECK (cost_currency_basis <> 'local' OR currency = 'USD');

COMMENT ON COLUMN process_cost_records.cost_currency_basis IS
  'What the money columns on this row can be trusted to be. local = money is denominated in cost_currency_local (which equals the currency column), written by a producer that honours the local-currency contract, safe to overlay into a local cost summary. converted = money is denominated in the currency column, converted from cost_currency_local at cost_fx_rate_from_local, so the conversion is fully traceable but the row is not local money. legacy_unverified = written before migration 707, when the currency column was stamped as a hardcoded literal and no local currency or rate was recorded, so the true denomination cannot be established from the row. Readers must not treat legacy_unverified as local money.';

COMMENT ON COLUMN process_cost_records.cost_currency_local IS
  'ISO 4217 code of the factory local currency the cost engine computed this line in, when the producer recorded it. Independent of the currency column, which states what the stored values were converted TO.';

COMMENT ON COLUMN process_cost_records.cost_fx_rate_from_local IS
  'Rate applied to reach the currency column from cost_currency_local: amount_local x cost_fx_rate_from_local = stored amount. 1 when the two currencies are the same. NULL when the producer did not record it. Stored as a value, not as a foreign key to fx_rate_snapshots, because that table is a per-day cache (migration 472) and not the authority for a resolved scenario rate.';

COMMENT ON COLUMN process_cost_records.currency IS
  'ISO 4217 code the money columns on this row are denominated in. Trust this only together with cost_currency_basis: on a legacy_unverified row it was written as a hardcoded literal, not resolved.';

-- 4. Carry the new columns through the generation-swap RPC
--
-- Same trap migration 706 fixed: a column absent from the jsonb_to_recordset
-- list is silently dropped, so the insert succeeds short a few columns and
-- nothing errors. Every column the writer sends must appear here.

CREATE OR REPLACE FUNCTION replace_active_process_cost_records(
  p_bom_item_id uuid,
  p_rows        jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_bom_item_id IS NULL THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: bom item id is required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: rows must be a json array, got %',
      COALESCE(jsonb_typeof(p_rows), 'null');
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: refusing to replace with an empty generation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_bom_item_id::text, 0));

  DELETE FROM process_cost_records
   WHERE bom_item_id = p_bom_item_id
     AND is_active = true;

  INSERT INTO process_cost_records (
    bom_item_id, user_id, op_nbr, operation, process_group, process_route,
    location, machine_class, machine_name, mhr_id, benchmark_mhr_id,
    machine_rate, labor_rate, lhr_id, direct_rate,
    setup_manning, setup_time, batch_size, heads, cycle_time,
    parts_per_cycle, scrap, currency, is_active, notes,
    setup_cost_per_part, total_cycle_cost_per_part, total_cost_per_part,
    cost_currency_basis, cost_currency_local, cost_fx_rate_from_local
  )
  SELECT
    p_bom_item_id, r.user_id, r.op_nbr, r.operation, r.process_group, r.process_route,
    r.location, r.machine_class, r.machine_name, r.mhr_id, r.benchmark_mhr_id,
    r.machine_rate, r.labor_rate, r.lhr_id, r.direct_rate,
    r.setup_manning, r.setup_time, r.batch_size, r.heads, r.cycle_time,
    r.parts_per_cycle, r.scrap, r.currency, true, r.notes,
    r.setup_cost_per_part, r.total_cycle_cost_per_part, r.total_cost_per_part,
    -- COALESCE only to the untrusted value, so a producer that omits the field
    -- lands on the safe side of the contract rather than on local.
    COALESCE(r.cost_currency_basis, 'legacy_unverified'),
    r.cost_currency_local, r.cost_fx_rate_from_local
  FROM jsonb_to_recordset(p_rows) AS r(
    user_id                  uuid,
    op_nbr                   integer,
    operation                varchar,
    process_group            varchar,
    process_route            varchar,
    location                 text,
    machine_class            varchar,
    machine_name             varchar,
    mhr_id                   uuid,
    benchmark_mhr_id         text,
    machine_rate             numeric,
    labor_rate               numeric,
    lhr_id                   uuid,
    direct_rate              numeric,
    setup_manning            numeric,
    setup_time               numeric,
    batch_size               numeric,
    heads                    numeric,
    cycle_time               numeric,
    parts_per_cycle          numeric,
    scrap                    numeric,
    currency                 varchar,
    notes                    text,
    setup_cost_per_part      numeric,
    total_cycle_cost_per_part numeric,
    total_cost_per_part      numeric,
    -- Added by migration 707.
    cost_currency_basis      text,
    cost_currency_local      varchar,
    cost_fx_rate_from_local  numeric
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'replace_active_process_cost_records: expected % rows, inserted %',
      jsonb_array_length(p_rows), v_inserted;
  END IF;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION replace_active_process_cost_records(uuid, jsonb) IS
  'Atomically replaces the active process_cost_records generation for a BOM item, including the engine per-line costs and the explicit currency contract columns added by migration 707. Delete and insert share one transaction, so a failure leaves the previous generation untouched and no partial generation can ever be active.';

GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_active_process_cost_records(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- Every existing row marked, none relabelled as local, no money changed:
--   SELECT cost_currency_basis, currency, count(*)
--     FROM process_cost_records GROUP BY 1, 2 ORDER BY 1, 2;
--
-- The rollup now states its currency:
--   SELECT currency, count(*) FROM bom_item_costs GROUP BY 1;
--
-- The gate rejects local money the rollup cannot yet accept:
--   UPDATE process_cost_records
--      SET cost_currency_basis = 'local', currency = 'INR'
--    WHERE id = (SELECT id FROM process_cost_records LIMIT 1);
--   -- expected: ERROR  new row violates check constraint
--   --           ck_process_cost_records_rollup_usd_until_p1b
