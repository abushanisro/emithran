-- Migration: rollup provenance on the BOM aggregate (P1b-iii, step 2)
-- Description: Adds the provenance the currency-aware rollup needs in order to
--              explain a total: the FX rates it applied, per-input denomination
--              and basis, and which inputs it could not trust.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- P1b-iii moves BOM aggregate money out of currency-blind SQL triggers and
-- into one application rollup. For that total to mean anything, the row has to
-- be able to answer four questions:
--
--   1. what currency is this denominated in?          currency_code
--   2. is it complete and trusted?                    currency_integrity
--   3. what FX rate converted each input, and         rollup_provenance
--      from which currency?
--   4. which inputs were legacy/unverified?           rollup_provenance
--
-- The first two already exist -- currency_code predates this work and
-- currency_integrity came from migration 708. The last two need somewhere to
-- live, and they are genuinely variable in shape: a rollup draws on up to six
-- input kinds, each of which may contribute several source rows in several
-- currencies. A jsonb document records that faithfully; a fixed set of columns
-- would either cap the number of currencies or invent a second table for
-- something only ever read as a whole.
--
-- Shape written by computeCurrencyAwareRollup (bom-item-rollup.ts):
--
--   {
--     "reportingCurrency": "USD",
--     "fxRates":  { "INR": 0.011976 },
--     "inputs": [
--       { "kind": "process", "ref": "<row id>", "currency": "INR",
--         "basis": "converted", "amountSource": 603.84,
--         "amountReporting": 7.23 },
--       { "kind": "tooling", "ref": "<row id>", "currency": null,
--         "basis": "legacy_unverified", "amountSource": 10.13,
--         "amountReporting": null,
--         "reason": "basis legacy_unverified cannot take part in a trusted total" }
--     ],
--     "untrustedKinds": ["tooling"],
--     "declaredCurrencies": ["INR"],
--     "computedAt": "2026-09-08T00:00:00.000Z"
--   }
--
-- Note what that example shows: when an input cannot be trusted, the rollup
-- records the untrusted amount and its reason, writes NO money, and leaves the
-- aggregate stale. The provenance explains the refusal, not a guess.
--
-- Nothing here changes an existing monetary value, and no default is applied
-- to existing rows beyond an empty document -- a row that has never been
-- through the currency-aware rollup correctly has no provenance to show.
--
-- Migrations 035, 037, 707, 708, 709 and 710 are not modified.

ALTER TABLE bom_item_costs
  ADD COLUMN IF NOT EXISTS rollup_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bom_item_costs.rollup_provenance IS
  'How the money on this row was arrived at, written only by the application rollup (bom-item-rollup.ts). Records the reporting currency, every FX rate applied and the currency it converted from, one entry per contributing source amount with its declared currency and cost_currency_basis, and which input kinds could not be trusted. An empty document means this row has never been through the currency-aware rollup. SQL triggers must never write this: they have no FX snapshot, which is the whole reason the rollup moved into application code (migration 709).';

-- Verification
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'bom_item_costs'
--      AND column_name IN ('currency_code', 'currency_integrity', 'rollup_provenance')
--    ORDER BY column_name;
--
-- Expected three rows. 'currency' must NOT appear (dropped by migration 710).
--
--   SELECT currency_integrity, count(*), count(*) FILTER (WHERE rollup_provenance <> '{}'::jsonb) AS with_provenance
--     FROM bom_item_costs GROUP BY 1;
--
-- Immediately after this migration: every row unverified, none with provenance.
