-- Migration 341: Backfill labor_rate on existing process_cost_records
-- ════════════════════════════════════════════════════════════════════════════════
--
-- ── WHY ───────────────────────────────────────────────────────────────────────
-- Rows written by applyRoute before migration 340 have labor_rate = 0 because
-- lsr_benchmark_rates did not yet exist. This migration patches those rows
-- in-place so users do not need to re-apply every route manually.
--
-- ── SAFETY GUARDS ─────────────────────────────────────────────────────────────
-- Only rows where:
--   labor_rate = 0                       (already correct rows are untouched)
--   notes LIKE 'auto_fill_from_route:%'  (only route-applied rows, not manual entries)
--   process_group IS NOT NULL            (needs a group to JOIN on)
--
-- ── LOCATION ──────────────────────────────────────────────────────────────────
-- Uses USA benchmark as the default for backfill.
-- USA is the previous hardcoded default in applyRoute.
-- Users who want a different location can re-apply the route from Process Planning.
--
-- ── DEPENDS ON ────────────────────────────────────────────────────────────────
-- Migration 340 (lsr_benchmark_rates table and seed data) must run first.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_cost_records pcr
SET
  labor_rate  = b.lhr_usd_effective,
  direct_rate = pcr.machine_rate + b.lhr_usd_effective
FROM lsr_benchmark_rates b
WHERE pcr.process_group = b.process_group
  AND b.location        = 'USA'
  AND pcr.labor_rate    = 0
  AND pcr.notes        LIKE 'auto_fill_from_route:%'
  AND pcr.process_group IS NOT NULL;
