-- Migration: declare the currency of every money row feeding the BOM rollup (P1b-i)
-- Description: Adds explicit currency provenance to the four cost-record tables
--              that aggregate into bom_item_costs, plus one integrity column on
--              the aggregate itself. Declares only. No money value changes, no
--              trigger changes, no aggregation behaviour changes.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- Migration 707 made process_cost_records state what currency its money is in.
-- A read-only trace of the rest of the rollup then established that
-- bom_item_costs does not merely have the THEORETICAL ability to mix
-- currencies -- it demonstrably already does, in live data.
--
-- One real aggregate row, bom_item b0eac6f0, labelled USD by 707:
--
--   process_cost              603.8419   from a process row whose own currency
--                                        column says INR (about 7.23 USD)
--   procured_parts_cost        96.8      sum of 89.6 + 7.2, both rows currency
--                                        INR (about 1.16 USD)
--   packaging_logistics_cost  273        no currency column exists on that
--                                        table at all, and no code path
--                                        anywhere converts it
--   raw_material_cost           0
--   tooling_cost                0        while three ACTIVE tooling rows for
--                                        the same item, all currency INR, total
--                                        20.4 -- so the aggregate is stale as
--                                        well as mixed
--   own_cost = total_cost     973.6419   reported as USD
--
-- That row reports 973.64 USD for money that is mostly rupees. It is a real
-- financial defect in existing data, not a hypothetical.
--
-- WHAT THE TRACE FOUND, PER PRODUCER
--
--   raw_material_cost_records      no currency column. unit_cost is converted
--                                  to USD ONLY on the auto-derive path
--                                  (rates.toUsd(lookup.price, lookup.currency)
--                                  in raw-material-cost.service.ts). A
--                                  user-supplied unitCost is stored verbatim
--                                  -- resolvedUnitCost starts as
--                                  createDto.unitCost and the conversion sits
--                                  behind an `=== 0` branch. So this table is
--                                  USD on one path and undeclared on the other.
--
--   packaging_logistics_cost_records
--                                  no currency column, and zero FX references
--                                  in its service. Denomination unknown.
--
--   procured_parts_cost_records    has a currency column, set from
--                                  dto.currency || 'USD' -- caller-declared
--                                  when supplied, fabricated USD when not.
--                                  Live data: 2 of 2 rows INR.
--
--   tooling_cost_records           has a currency column, hardcoded to the
--                                  literal 'USD' in tooling-cost.service.ts.
--                                  Live data: 3 of 3 rows INR. The code
--                                  assertion and the data disagree, which is
--                                  why the column cannot be trusted as-is.
--
--   bom_item_costs.direct_children_cost
--                                  inherits whatever mixture the children hold
--                                  -- bom-item-cost.service.ts sums
--                                  childCost.total_cost * quantity with no
--                                  currency handling -- so the problem
--                                  compounds up an assembly tree.
--
-- Also relevant: child_part_cost_records.currency DEFAULTs to INR
-- (migration 036), a fourth convention alongside hardcoded USD, code-enforced
-- USD and caller-declared. And no consumer converts anything:
-- cost-aggregation.service.ts, production-planning.service.ts and
-- child-part-cost.service.ts contain zero FX references between them.
--
-- SCOPE OF THIS MIGRATION
--
-- Declare only. Every stored amount keeps its exact current value, every
-- trigger keeps its exact current behaviour, and the aggregate keeps computing
-- exactly what it computes today. The point is to make the denomination of
-- each row a fact in the database instead of a convention in a comment, so
-- that P1b-iii can build a currency-aware rollup on real data rather than on
-- assumptions.
--
-- Deliberately NOT here:
--   P1b-ii   changing the four sync_* triggers to invalidate instead of
--            computing money.
--   P1b-iii  the single currency-aware application rollup.
--   P1b-iv   flipping process_cost_records to local-currency persistence and
--            dropping the 707 gate.
--
-- WHY THERE IS NO ROLLUP GATE HERE
--
-- 707 added ck_process_cost_records_rollup_usd_until_p1b, which forbids
-- declaring local-basis money while the rollup still assumes USD. The
-- equivalent constraint is deliberately NOT added to these four tables:
-- procured parts already accepts a caller-supplied currency and real INR rows
-- exist, so a USD-only constraint would reject data the application currently
-- accepts and would break a path people actively use. These tables get honest
-- labels now; P1b-iii is where the rollup learns to refuse what it cannot
-- interpret, which is the correct place for that decision.

-- The shared vocabulary, identical to 707 so the platform has ONE set of
-- values rather than a per-table dialect:
--
--   legacy_unverified  the currency column cannot be trusted for this row
--   converted          money is in `currency`, converted from
--                      cost_currency_local at cost_fx_rate_from_local
--   local              money is in cost_currency_local, which equals
--                      `currency`; no conversion was applied
--
-- 707 documents `local` in terms of the cost engine because process rows are
-- engine-produced. The assertion is the same one these tables need: the
-- currency column is authoritative and nothing was converted.

-- 1. raw_material_cost_records

ALTER TABLE raw_material_cost_records
  ADD COLUMN IF NOT EXISTS currency                varchar(3),
  ADD COLUMN IF NOT EXISTS cost_currency_basis     text,
  ADD COLUMN IF NOT EXISTS cost_currency_local     varchar(3),
  ADD COLUMN IF NOT EXISTS cost_fx_rate_from_local numeric(18, 8);

UPDATE raw_material_cost_records
   SET cost_currency_basis = 'legacy_unverified'
 WHERE cost_currency_basis IS NULL;

ALTER TABLE raw_material_cost_records
  ALTER COLUMN cost_currency_basis SET DEFAULT 'legacy_unverified';

ALTER TABLE raw_material_cost_records
  ALTER COLUMN cost_currency_basis SET NOT NULL;

-- `currency` is left NULL on existing rows rather than backfilled to USD.
-- Backfilling would assert the very thing the trace could not establish: these
-- rows are USD when auto-derived and undeclared when hand-entered, and the row
-- does not record which path produced it.

-- 2. packaging_logistics_cost_records

ALTER TABLE packaging_logistics_cost_records
  ADD COLUMN IF NOT EXISTS currency                varchar(3),
  ADD COLUMN IF NOT EXISTS cost_currency_basis     text,
  ADD COLUMN IF NOT EXISTS cost_currency_local     varchar(3),
  ADD COLUMN IF NOT EXISTS cost_fx_rate_from_local numeric(18, 8);

UPDATE packaging_logistics_cost_records
   SET cost_currency_basis = 'legacy_unverified'
 WHERE cost_currency_basis IS NULL;

ALTER TABLE packaging_logistics_cost_records
  ALTER COLUMN cost_currency_basis SET DEFAULT 'legacy_unverified';

ALTER TABLE packaging_logistics_cost_records
  ALTER COLUMN cost_currency_basis SET NOT NULL;

-- 3. procured_parts_cost_records  (currency column already exists)

ALTER TABLE procured_parts_cost_records
  ADD COLUMN IF NOT EXISTS cost_currency_basis     text,
  ADD COLUMN IF NOT EXISTS cost_currency_local     varchar(3),
  ADD COLUMN IF NOT EXISTS cost_fx_rate_from_local numeric(18, 8);

UPDATE procured_parts_cost_records
   SET cost_currency_basis = 'legacy_unverified'
 WHERE cost_currency_basis IS NULL;

ALTER TABLE procured_parts_cost_records
  ALTER COLUMN cost_currency_basis SET DEFAULT 'legacy_unverified';

ALTER TABLE procured_parts_cost_records
  ALTER COLUMN cost_currency_basis SET NOT NULL;

-- Existing rows keep their stated currency but are NOT promoted to `local`,
-- because dto.currency || 'USD' means a stored USD cannot be distinguished
-- from a fabricated one after the fact. The live INR rows are almost certainly
-- caller-declared and correct -- and are still marked unverified, because
-- almost certainly is not a basis for arithmetic on money.

-- 4. tooling_cost_records  (currency column already exists)

ALTER TABLE tooling_cost_records
  ADD COLUMN IF NOT EXISTS cost_currency_basis     text,
  ADD COLUMN IF NOT EXISTS cost_currency_local     varchar(3),
  ADD COLUMN IF NOT EXISTS cost_fx_rate_from_local numeric(18, 8);

UPDATE tooling_cost_records
   SET cost_currency_basis = 'legacy_unverified'
 WHERE cost_currency_basis IS NULL;

ALTER TABLE tooling_cost_records
  ALTER COLUMN cost_currency_basis SET DEFAULT 'legacy_unverified';

ALTER TABLE tooling_cost_records
  ALTER COLUMN cost_currency_basis SET NOT NULL;

-- 5. The same integrity constraints 707 uses, on all four tables
--
-- A converted row must be able to describe its own conversion, and a local row
-- must agree with the local currency it claims. Without these, the basis
-- column would be a label a producer could set without the data to back it.

ALTER TABLE raw_material_cost_records
  DROP CONSTRAINT IF EXISTS ck_rmcr_cost_currency_basis;
ALTER TABLE raw_material_cost_records
  ADD CONSTRAINT ck_rmcr_cost_currency_basis
  CHECK (cost_currency_basis IN ('legacy_unverified', 'converted', 'local'));

ALTER TABLE raw_material_cost_records
  DROP CONSTRAINT IF EXISTS ck_rmcr_currency_traceable;
ALTER TABLE raw_material_cost_records
  ADD CONSTRAINT ck_rmcr_currency_traceable
  CHECK (
    (cost_currency_basis <> 'converted'
     OR (cost_currency_local IS NOT NULL AND cost_fx_rate_from_local IS NOT NULL))
    AND
    (cost_currency_basis <> 'local'
     OR (cost_currency_local IS NOT NULL AND currency = cost_currency_local))
  );

ALTER TABLE packaging_logistics_cost_records
  DROP CONSTRAINT IF EXISTS ck_plcr_cost_currency_basis;
ALTER TABLE packaging_logistics_cost_records
  ADD CONSTRAINT ck_plcr_cost_currency_basis
  CHECK (cost_currency_basis IN ('legacy_unverified', 'converted', 'local'));

ALTER TABLE packaging_logistics_cost_records
  DROP CONSTRAINT IF EXISTS ck_plcr_currency_traceable;
ALTER TABLE packaging_logistics_cost_records
  ADD CONSTRAINT ck_plcr_currency_traceable
  CHECK (
    (cost_currency_basis <> 'converted'
     OR (cost_currency_local IS NOT NULL AND cost_fx_rate_from_local IS NOT NULL))
    AND
    (cost_currency_basis <> 'local'
     OR (cost_currency_local IS NOT NULL AND currency = cost_currency_local))
  );

ALTER TABLE procured_parts_cost_records
  DROP CONSTRAINT IF EXISTS ck_ppcr_cost_currency_basis;
ALTER TABLE procured_parts_cost_records
  ADD CONSTRAINT ck_ppcr_cost_currency_basis
  CHECK (cost_currency_basis IN ('legacy_unverified', 'converted', 'local'));

ALTER TABLE procured_parts_cost_records
  DROP CONSTRAINT IF EXISTS ck_ppcr_currency_traceable;
ALTER TABLE procured_parts_cost_records
  ADD CONSTRAINT ck_ppcr_currency_traceable
  CHECK (
    (cost_currency_basis <> 'converted'
     OR (cost_currency_local IS NOT NULL AND cost_fx_rate_from_local IS NOT NULL))
    AND
    (cost_currency_basis <> 'local'
     OR (cost_currency_local IS NOT NULL AND currency = cost_currency_local))
  );

ALTER TABLE tooling_cost_records
  DROP CONSTRAINT IF EXISTS ck_tcr_cost_currency_basis;
ALTER TABLE tooling_cost_records
  ADD CONSTRAINT ck_tcr_cost_currency_basis
  CHECK (cost_currency_basis IN ('legacy_unverified', 'converted', 'local'));

ALTER TABLE tooling_cost_records
  DROP CONSTRAINT IF EXISTS ck_tcr_currency_traceable;
ALTER TABLE tooling_cost_records
  ADD CONSTRAINT ck_tcr_currency_traceable
  CHECK (
    (cost_currency_basis <> 'converted'
     OR (cost_currency_local IS NOT NULL AND cost_fx_rate_from_local IS NOT NULL))
    AND
    (cost_currency_basis <> 'local'
     OR (cost_currency_local IS NOT NULL AND currency = cost_currency_local))
  );

-- 6. The aggregate records whether its inputs were interpretable
--
-- Nothing writes this until P1b-iii. The default is the untrusted value, so
-- the 25 existing aggregate rows immediately describe themselves accurately:
-- no code has ever verified that their inputs shared one currency, and the
-- b0eac6f0 row proves at least one did not.

ALTER TABLE bom_item_costs
  ADD COLUMN IF NOT EXISTS currency_integrity text NOT NULL DEFAULT 'unverified';

ALTER TABLE bom_item_costs
  DROP CONSTRAINT IF EXISTS ck_bic_currency_integrity;
ALTER TABLE bom_item_costs
  ADD CONSTRAINT ck_bic_currency_integrity
  CHECK (currency_integrity IN ('unverified', 'consistent', 'mixed'));

-- Column documentation

COMMENT ON COLUMN raw_material_cost_records.currency IS
  'ISO 4217 code the money columns on this row are denominated in. NULL means undeclared. Trust it only together with cost_currency_basis. Added by migration 708.';
COMMENT ON COLUMN packaging_logistics_cost_records.currency IS
  'ISO 4217 code the money columns on this row are denominated in. NULL means undeclared. Trust it only together with cost_currency_basis. Added by migration 708.';

COMMENT ON COLUMN raw_material_cost_records.cost_currency_basis IS
  'Whether the currency column can be trusted for this row. legacy_unverified = no, converted = money is in currency and was converted from cost_currency_local at cost_fx_rate_from_local, local = money is in cost_currency_local which equals currency, no conversion applied. Same vocabulary as process_cost_records (migration 707).';
COMMENT ON COLUMN packaging_logistics_cost_records.cost_currency_basis IS
  'Whether the currency column can be trusted for this row. Same vocabulary as process_cost_records (migration 707). Historically this table had no currency column at all and nothing converted its values.';
COMMENT ON COLUMN procured_parts_cost_records.cost_currency_basis IS
  'Whether the currency column can be trusted for this row. Same vocabulary as process_cost_records (migration 707). The currency column is caller-declared when supplied and defaulted to USD when not, so a stored USD is not by itself evidence.';
COMMENT ON COLUMN tooling_cost_records.cost_currency_basis IS
  'Whether the currency column can be trusted for this row. Same vocabulary as process_cost_records (migration 707). The writer hardcoded USD while every live row held INR, so pre-708 values on this column carry no information.';

COMMENT ON COLUMN bom_item_costs.currency_integrity IS
  'Whether the inputs to this aggregate were all denominated in the currency column when it was last computed. unverified = never checked by currency-aware code, which is true of every row written before P1b-iii. consistent = every input declared the same currency as this row. mixed = inputs disagreed and the totals on this row cannot be trusted as a single currency. Written by the application rollup, never by a trigger.';

-- Verification
--
-- Every money row now declares a basis, and none was silently promoted:
--   SELECT 'raw_material'  AS t, cost_currency_basis, currency, count(*) FROM raw_material_cost_records        GROUP BY 1,2,3
--   UNION ALL SELECT 'packaging',  cost_currency_basis, currency, count(*) FROM packaging_logistics_cost_records GROUP BY 1,2,3
--   UNION ALL SELECT 'procured',   cost_currency_basis, currency, count(*) FROM procured_parts_cost_records      GROUP BY 1,2,3
--   UNION ALL SELECT 'tooling',    cost_currency_basis, currency, count(*) FROM tooling_cost_records             GROUP BY 1,2,3
--   ORDER BY 1,2,3;
--
-- The aggregate admits it has never been verified:
--   SELECT currency_integrity, count(*) FROM bom_item_costs GROUP BY 1;
--
-- No money moved. Compare before and after:
--   SELECT sum(total_cost) FROM procured_parts_cost_records WHERE is_active;
--   SELECT sum(total_cost) FROM tooling_cost_records        WHERE is_active;
--   SELECT sum(process_cost), sum(own_cost), sum(total_cost) FROM bom_item_costs;
--
-- A local-basis row must agree with itself (expected: constraint violation):
--   UPDATE tooling_cost_records SET cost_currency_basis = 'local',
--          currency = 'USD', cost_currency_local = 'INR'
--    WHERE id = (SELECT id FROM tooling_cost_records LIMIT 1);
