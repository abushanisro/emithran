-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 475: Backfill stale process_cost_records.machine_rate/labor_rate
-- from their linked MHR/LHR records' current real USD rate (2026-08-18)
--
-- process_cost_records.machine_rate/labor_rate are always supposed to be
-- stored in USD -- process-cost.service.ts's toUsdCreate/toUsdIfProvided
-- convert every incoming rate before persisting, and the Digital Factory's
-- display currency is applied only at read time (bom-items.service.ts's
-- normalizeCostSummaryToCurrency / usdToDisplayRate).
--
-- Some rows were saved before mhr_records.mhr_usd_per_hour /
-- lhr_records.lhr_usd_effective existed (or were correctly populated) for
-- their linked machine/labour row -- at save time the app fell back to the
-- RAW LOCAL-CURRENCY figure (mhr_records.total_machine_hour_rate /
-- lhr_records.lhr) as if it were already USD, and that wrong number was
-- persisted verbatim, permanently mislabeled currency='USD'.
--
-- Confirmed live (2026-08-18, item 006deb8a-6d6c-4d8a-a2fa-137d07776ea8): a
-- Laser Cut row linked to the India "Salvagnini L3-30 Fiber" machine
-- (mhr_records.id = 0a611930-3e84-487e-a4b7-ca0f9a164202) had
-- process_cost_records.machine_rate = 1605.50 (that machine's raw INR
-- total_machine_hour_rate) while mhr_records.mhr_usd_per_hour for the same
-- machine is the correct 19.00 -- an ~84x inflation. It stayed invisible
-- while the Digital Factory was India (the INR budget-rate math happened to
-- make the number look plausible), then surfaced as an absurd "€1489.43/hr"
-- the moment the scenario currency changed to EUR.
--
-- This migration re-syncs machine_rate/labor_rate for every ACTIVE
-- process_cost_records row linked (via mhr_id/lhr_id) to a real machine/
-- labour record that has a real, positive USD rate on file. It deliberately
-- does NOT touch:
--   - rows with no mhr_id/lhr_id (a genuinely manual, unlinked rate --
--     overwriting it would destroy a deliberate manual entry; the app never
--     lets you edit machine_rate/labor_rate independently once a real
--     mhr_id/lhr_id is linked -- see ProcessCostDialog's effectiveMachineRate/
--     effectiveLaborRate, which are always DERIVED from the linked record)
--   - rows linked only via benchmark_mhr_id/benchmark_lhr_id (benchmark
--     rates are resolved fresh server-side on every read, never frozen into
--     machine_rate/labor_rate the same way a real mhr_id/lhr_id link is)
--
-- Safe to re-run (idempotent -- IS DISTINCT FROM guards mean a clean row is
-- simply skipped on a second run).
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Verify BEFORE running (see how many rows / how bad) ────────────────────────
-- SELECT pcr.id, pcr.operation, pcr.location, pcr.machine_rate AS stored_usd,
--        m.mhr_usd_per_hour AS real_usd, m.total_machine_hour_rate, m.location AS machine_location
-- FROM process_cost_records pcr
-- JOIN mhr_records m ON pcr.mhr_id = m.id
-- WHERE pcr.is_active = true
--   AND m.mhr_usd_per_hour IS NOT NULL AND m.mhr_usd_per_hour > 0
--   AND pcr.machine_rate IS DISTINCT FROM m.mhr_usd_per_hour
-- ORDER BY (pcr.machine_rate / NULLIF(m.mhr_usd_per_hour, 0)) DESC;
--
-- SELECT pcr.id, pcr.operation, pcr.location, pcr.labor_rate AS stored_usd,
--        l.lhr_usd_effective AS real_usd, l.lhr, l.location AS labour_location
-- FROM process_cost_records pcr
-- JOIN lhr_records l ON pcr.lhr_id = l.id
-- WHERE pcr.is_active = true
--   AND l.lhr_usd_effective IS NOT NULL AND l.lhr_usd_effective > 0
--   AND pcr.labor_rate IS DISTINCT FROM l.lhr_usd_effective
-- ORDER BY (pcr.labor_rate / NULLIF(l.lhr_usd_effective, 0)) DESC;

UPDATE process_cost_records pcr
SET machine_rate = m.mhr_usd_per_hour,
    updated_at = now()
FROM mhr_records m
WHERE pcr.mhr_id = m.id
  AND pcr.is_active = true
  AND m.mhr_usd_per_hour IS NOT NULL
  AND m.mhr_usd_per_hour > 0
  AND pcr.machine_rate IS DISTINCT FROM m.mhr_usd_per_hour;

UPDATE process_cost_records pcr
SET labor_rate = l.lhr_usd_effective,
    updated_at = now()
FROM lhr_records l
WHERE pcr.lhr_id = l.id
  AND pcr.is_active = true
  AND l.lhr_usd_effective IS NOT NULL
  AND l.lhr_usd_effective > 0
  AND pcr.labor_rate IS DISTINCT FROM l.lhr_usd_effective;

-- ── Verify AFTER running -- expect 0 rows from both queries above ──────────────
