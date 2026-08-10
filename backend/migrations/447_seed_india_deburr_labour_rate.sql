-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 447: Seed India's real, distinct Deburr labour rate (2026-08-08)
--
-- Migration 411 deliberately excluded India from its Deburr-specific LHR
-- tier, reasoning (its own comment): the source spreadsheet's "Manual
-- operation" Deburr rows for India show Skill Based Labor Rate = 1.73 —
-- IDENTICAL to the shared Sheet Metal tier's 1.73 — so no distinct number
-- existed to seed.
--
-- Re-checked memory/database/Combined_All_Countries_Database.json directly:
-- India actually has TWO separate Deburr clusters, not one:
--   Sl.No. 388-392 ("Manual Bench Cell - NxM Footprint" / "Default Automated
--     Deburr") — the cluster migration 411 read — Manual rows = 1.73,
--     Automated = 1.65.
--   Sl.No. 460 ("Default Manual Deburr", Total Overhead Rate = 1.09) — a
--     LATER, separate entry whose MACHINE rate (1.09) is the exact one this
--     app's live mhr_benchmark_rates already uses today (migration 361's
--     'Deburring Cell' / India row, machine_ref 'Manual Deburr bench') — the
--     real machine this app actually costs Deburring against. THIS entry's
--     Skill Based Labor Rate is 1.65, not 1.73 — a real, distinct number
--     migration 411 never saw because it was reading the other cluster.
--
-- Since 1.65 is sourced from the exact record tied to the exact machine
-- (1.09 MHR) this app already prices Deburring with, it's the correct real
-- number to seed here — genuinely distinct from Sheet Metal's 1.73, same as
-- USA/Germany/China/Mexico already are in migration 411.
--
-- `lhr` (local currency, INR) is computed from lhr_usd_effective via the
-- live exchange_rates table — same convention as migration 446's fix,
-- never a hardcoded local number that can drift out of sync.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
SELECT
  'BM-IN-DB', 'Manual Deburr Operator',
  '2026 all-in LHR — India / Deburr (Combined_All_Countries_Database.json, Sl.No. 460 — "Default Manual Deburr", matches live mhr_benchmark_rates Deburring Cell 1.09 machine rate)',
  ROUND(
    1.65 * (SELECT rate FROM exchange_rates WHERE from_currency = 'USD' AND to_currency = 'INR' AND is_active LIMIT 1),
    2
  ),
  'India', 'Deburr', 'INR', '₹', 1.65
ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, process_group, lhr, lhr_usd_effective FROM lhr_benchmark_rates
-- WHERE process_group = 'Deburr' ORDER BY location;
-- Expect a new India row: lhr ≈ 137.78 (INR), lhr_usd_effective = 1.65 —
-- alongside the existing USA/Germany/China/Mexico rows from migration 411.
-- UK/France/W. Europe/E. Europe/Vietnam remain correctly un-seeded (no
-- Deburr-specific data exists for them in the source database) — Deburring
-- in those locations still correctly falls back to the shared Sheet Metal
-- DLR tier, an honest "less granular but real" fallback, not a gap.
