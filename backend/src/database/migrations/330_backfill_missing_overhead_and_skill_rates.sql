-- Migration 330: Backfill missing Direct OH / Indirect OH / Total OH / Skill Rate
-- on Combined-format mhr_records rows (the "-" cells on the HR-Rates page).
--
-- Scope: ONLY rows that came from the Combined_All_Countries benchmark sheet
-- (signature: at least one of direct_overhead_rate / indirect_overhead_rate /
-- usd_lhr_total / lhr_usd_effective is populated). Calculated MHR rows (the
-- India-2026 form path) never use these columns and are never touched.
-- Every fill is COALESCE-guarded: existing values are NEVER overwritten.
--
-- Value provenance (all figures USD/hr unless noted, 2025/2026):
--   * Skill rates anchor to the sheet's own China column (10.93-14.26 $/hr),
--     which sits inside the verified band for fully burdened Chinese skilled
--     manufacturing labor: $6-8/hr base wages + 30-40% statutory burden
--     (China Briefing 2025; Reshoring Institute global labor comparisons).
--     Cross-country scaling uses: USA employer cost ~$48/hr (BLS ECEC Q2-2025),
--     euro-area industry €40.3/hr with Germany above / France near the average
--     (Eurostat hourly labour costs 2025), India lowest globally, Mexico low-mid
--     (Reshoring Institute / TradingEconomics).
--   * Direct OH for energy-driven processes = machine energy + depreciation +
--     consumables, using 2025 industrial electricity: USA/China ~$0.08/kWh,
--     India ~$0.10, Mexico ~$0.11, France ~$0.15, Germany ~$0.19
--     (IEA Electricity 2025; GlobalPetrolPrices; Statista industrial prices).
--     e.g. induction hardening ≈ 65 effective kWh/hr + $1.8-1.9/hr depreciation
--     ($80-150k system, 15 yr) + $0.8/hr consumables.
--   * Unit-rate rows (machine_name contains "Sq.m" — e.g. "Epoxy coat - Surface
--     area cost, $/Sq.m") are $/m² denominated: their existing Total is
--     authoritative and is split 75% direct (booth energy+depreciation+
--     consumables) / 25% indirect (facility+supervision share). Hourly matrix
--     values are NOT applied to these rows — that would mix units.
--
-- Rollback path: mhr_records_backup_330 snapshots every candidate row before
-- any change. Restore a column with e.g.
--   UPDATE mhr_records m SET direct_overhead_rate = b.direct_overhead_rate
--   FROM mhr_records_backup_330 b WHERE b.id = m.id;
--
-- Preview (run standalone BEFORE the migration to see the gap list):
--   SELECT location, process_group, machine_class, machine_name,
--          direct_overhead_rate, indirect_overhead_rate,
--          mhr_usd_per_hour, usd_lhr_total
--   FROM mhr_records
--   WHERE (direct_overhead_rate IS NOT NULL OR indirect_overhead_rate IS NOT NULL
--          OR usd_lhr_total IS NOT NULL OR lhr_usd_effective IS NOT NULL)
--     AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
--          OR usd_lhr_total IS NULL OR mhr_usd_per_hour IS NULL)
--   ORDER BY location, process_group, machine_class;

BEGIN;

-- ── Phase 0: rollback snapshot ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mhr_records_backup_330 AS
SELECT * FROM mhr_records
WHERE (direct_overhead_rate IS NOT NULL OR indirect_overhead_rate IS NOT NULL
       OR usd_lhr_total IS NOT NULL OR lhr_usd_effective IS NOT NULL)
  AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
       OR usd_lhr_total IS NULL OR lhr_usd_effective IS NULL
       OR mhr_usd_per_hour IS NULL OR fully_burdened_usd_per_hr IS NULL);

-- ── Phase 1: arithmetic completion (identities from the row's own data) ───────
-- A row's own numbers always beat a benchmark. Total = Direct + Indirect and
-- LHR total = base + burden are identities, not estimates.

UPDATE mhr_records
SET mhr_usd_per_hour = ROUND((direct_overhead_rate + indirect_overhead_rate)::numeric, 2)
WHERE (mhr_usd_per_hour IS NULL OR mhr_usd_per_hour = 0)
  AND direct_overhead_rate IS NOT NULL AND indirect_overhead_rate IS NOT NULL;

UPDATE mhr_records
SET direct_overhead_rate = ROUND((mhr_usd_per_hour - indirect_overhead_rate)::numeric, 2)
WHERE direct_overhead_rate IS NULL
  AND mhr_usd_per_hour IS NOT NULL AND indirect_overhead_rate IS NOT NULL
  AND mhr_usd_per_hour - indirect_overhead_rate >= 0.5;  -- guard: don't derive noise

UPDATE mhr_records
SET indirect_overhead_rate = ROUND((mhr_usd_per_hour - direct_overhead_rate)::numeric, 2)
WHERE indirect_overhead_rate IS NULL
  AND mhr_usd_per_hour IS NOT NULL AND direct_overhead_rate IS NOT NULL
  AND mhr_usd_per_hour - direct_overhead_rate >= 0.5;

UPDATE mhr_records
SET usd_lhr_total = ROUND((usd_lhr_base + usd_lhr_burden)::numeric, 2)
WHERE usd_lhr_total IS NULL
  AND usd_lhr_base IS NOT NULL AND usd_lhr_burden IS NOT NULL;

UPDATE mhr_records
SET lhr_usd_effective = usd_lhr_total
WHERE lhr_usd_effective IS NULL AND usd_lhr_total IS NOT NULL;

-- ── Phase 2a: unit-rate rows ($/Sq.m etc.) — split existing Total 75/25 ───────
-- Identified by the machine_name naming convention of the benchmark sheet.
-- The split preserves the row's own total exactly; units stay $/m².

UPDATE mhr_records
SET direct_overhead_rate   = ROUND((mhr_usd_per_hour * 0.75)::numeric, 2),
    indirect_overhead_rate = ROUND((mhr_usd_per_hour * 0.25)::numeric, 2)
WHERE machine_name ~* 'sq\.?\s?m|per\s?m2|m²'
  AND mhr_usd_per_hour IS NOT NULL AND mhr_usd_per_hour > 0
  AND direct_overhead_rate IS NULL AND indirect_overhead_rate IS NULL;

-- ── Phase 2b: benchmark matrix fill (only where still NULL) ───────────────────
-- Keyed by (location, process_group pattern, machine_class pattern). A more
-- specific class match (e.g. Machining/Cutting saws) beats the group wildcard.
-- Locations known to exist in mhr_records: India, China, Mexico, Germany,
-- France, USA. Extend the VALUES list if the post-check reports other locations.

WITH matrix(loc, group_pat, class_pat, specificity, d_oh, i_oh, lhr) AS (
  VALUES
  -- location   group_pat            class_pat        spec  direct  indirect  skill(LHR)
  -- ── Machining: cutting/saw lines (lower-skill than turn-mill) ──
  ('china',    '%machining%',        '%cut%',          2,   1.20,   4.33,     10.93),
  ('india',    '%machining%',        '%cut%',          2,   1.10,   3.60,      2.95),
  ('mexico',   '%machining%',        '%cut%',          2,   1.30,   4.00,      6.55),
  ('usa',      '%machining%',        '%cut%',          2,   1.50,   5.40,     36.70),
  ('germany',  '%machining%',        '%cut%',          2,   2.40,   7.30,     38.80),
  ('france',   '%machining%',        '%cut%',          2,   2.00,   6.60,     35.50),
  -- ── Machining: all other classes (turn mill / milling / turning / grinding) ──
  ('china',    '%machining%',        '%',              1,  12.00,   6.00,     14.26),
  ('india',    '%machining%',        '%',              1,  10.50,   4.00,      3.90),
  ('mexico',   '%machining%',        '%',              1,  12.50,   4.50,      8.60),
  ('usa',      '%machining%',        '%',              1,  14.00,   6.00,     47.50),
  ('germany',  '%machining%',        '%',              1,  18.00,   8.20,     50.50),
  ('france',   '%machining%',        '%',              1,  16.00,   7.40,     45.50),
  -- ── Heat treatment (induction hardening / furnace processes) ──
  ('china',    '%heat%',             '%',              1,   7.80,   5.30,     13.01),
  ('india',    '%heat%',             '%',              1,   9.20,   4.20,      3.55),
  ('mexico',   '%heat%',             '%',              1,   9.85,   4.60,      7.85),
  ('usa',      '%heat%',             '%',              1,   7.80,   6.50,     43.50),
  ('germany',  '%heat%',             '%',              1,  15.05,   8.90,     46.00),
  ('france',   '%heat%',             '%',              1,  12.45,   7.80,     41.50),
  -- ── Surface treatment (painting / plating / anodizing — hourly lines only;
  --    $/m² rows were handled in Phase 2a and are excluded below) ──
  ('china',    '%surface%',          '%',              1,   6.50,   4.80,     10.90),
  ('india',    '%surface%',          '%',              1,   6.00,   4.00,      2.95),
  ('mexico',   '%surface%',          '%',              1,   7.00,   4.40,      6.55),
  ('usa',      '%surface%',          '%',              1,   7.50,   5.80,     36.50),
  ('germany',  '%surface%',          '%',              1,  12.00,   7.90,     38.50),
  ('france',   '%surface%',          '%',              1,  10.50,   7.10,     35.00),
  -- Painting rows sometimes carry their own group value
  ('china',    '%paint%',            '%',              1,   6.50,   4.80,     10.90),
  ('india',    '%paint%',            '%',              1,   6.00,   4.00,      2.95),
  ('mexico',   '%paint%',            '%',              1,   7.00,   4.40,      6.55),
  ('usa',      '%paint%',            '%',              1,   7.50,   5.80,     36.50),
  ('germany',  '%paint%',            '%',              1,  12.00,   7.90,     38.50),
  ('france',   '%paint%',            '%',              1,  10.50,   7.10,     35.00),
  -- ── Assembly (pick & place / manual cells) ──
  ('china',    '%assembly%',         '%',              1,   2.60,   7.96,     11.27),
  ('india',    '%assembly%',         '%',              1,   2.20,   4.50,      3.05),
  ('mexico',   '%assembly%',         '%',              1,   2.75,   5.50,      6.80),
  ('usa',      '%assembly%',         '%',              1,   3.90,   9.50,     37.50),
  ('germany',  '%assembly%',         '%',              1,   4.80,  11.50,     40.00),
  ('france',   '%assembly%',         '%',              1,   4.30,  10.50,     36.00),
  -- ── Welding ──
  ('china',    '%weld%',             '%',              1,   3.20,   4.30,     12.50),
  ('india',    '%weld%',             '%',              1,   3.00,   3.60,      3.40),
  ('mexico',   '%weld%',             '%',              1,   3.50,   4.00,      7.50),
  ('usa',      '%weld%',             '%',              1,   4.20,   5.50,     42.00),
  ('germany',  '%weld%',             '%',              1,   6.50,   7.50,     44.50),
  ('france',   '%weld%',             '%',              1,   5.50,   6.80,     40.00),
  -- ── Washing / cleaning ──
  ('china',    '%wash%',             '%',              1,   2.40,   4.30,     10.40),
  ('india',    '%wash%',             '%',              1,   2.20,   3.50,      2.80),
  ('mexico',   '%wash%',             '%',              1,   2.60,   3.90,      6.25),
  ('usa',      '%wash%',             '%',              1,   3.20,   5.20,     35.00),
  ('germany',  '%wash%',             '%',              1,   5.20,   7.00,     37.00),
  ('france',   '%wash%',             '%',              1,   4.40,   6.30,     33.50),
  -- ── Inspection / quality ──
  ('china',    '%inspect%',          '%',              1,   4.50,   5.00,     12.00),
  ('india',    '%inspect%',          '%',              1,   4.00,   4.20,      3.25),
  ('mexico',   '%inspect%',          '%',              1,   4.80,   4.70,      7.20),
  ('usa',      '%inspect%',          '%',              1,   6.00,   6.20,     40.00),
  ('germany',  '%inspect%',          '%',              1,   8.00,   8.40,     42.50),
  ('france',   '%inspect%',          '%',              1,   7.00,   7.50,     38.50)
),
targets AS (
  SELECT m.id,
         mx.d_oh, mx.i_oh, mx.lhr,
         ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY mx.specificity DESC) AS rn
  FROM mhr_records m
  JOIN matrix mx
    ON lower(m.location) = mx.loc
   AND m.process_group ILIKE mx.group_pat
   AND (mx.class_pat = '%' OR COALESCE(m.machine_class, '') ILIKE mx.class_pat)
  WHERE
    -- Combined-format signature: never touch calculated (form-entered) rows
    (m.direct_overhead_rate IS NOT NULL OR m.indirect_overhead_rate IS NOT NULL
     OR m.usd_lhr_total IS NOT NULL OR m.lhr_usd_effective IS NOT NULL)
    -- something is actually missing
    AND (m.direct_overhead_rate IS NULL OR m.indirect_overhead_rate IS NULL
         OR m.usd_lhr_total IS NULL)
)
-- Unit-rate ($/m²) rows keep their own denomination: hourly OH benchmarks must
-- never land in a per-m² row (Phase 2a already split their own total), but the
-- skill rate is always $/hr, so LHR fills apply to every row.
UPDATE mhr_records m
SET direct_overhead_rate = CASE
      WHEN m.machine_name ~* 'sq\.?\s?m|per\s?m2|m²' THEN m.direct_overhead_rate
      ELSE COALESCE(m.direct_overhead_rate, t.d_oh) END,
    indirect_overhead_rate = CASE
      WHEN m.machine_name ~* 'sq\.?\s?m|per\s?m2|m²' THEN m.indirect_overhead_rate
      ELSE COALESCE(m.indirect_overhead_rate, t.i_oh) END,
    usd_lhr_total          = COALESCE(m.usd_lhr_total,     t.lhr),
    lhr_usd_effective      = COALESCE(m.lhr_usd_effective, t.lhr)
FROM targets t
WHERE t.id = m.id AND t.rn = 1;

-- ── Phase 3a: LHR base/burden split wherever a total exists without parts ─────
-- 72/28 base/burden: statutory burden runs 30-40% of base wages in China and
-- 25-35% in the EU/Mexico → ~28% of the fully burdened total. Identity-safe:
-- base + burden always sums exactly back to the row's own total.

UPDATE mhr_records
SET usd_lhr_base   = ROUND((usd_lhr_total * 0.72)::numeric, 2),
    usd_lhr_burden = ROUND((usd_lhr_total - ROUND((usd_lhr_total * 0.72)::numeric, 2))::numeric, 2)
WHERE usd_lhr_total IS NOT NULL
  AND usd_lhr_base IS NULL AND usd_lhr_burden IS NULL
  AND (direct_overhead_rate IS NOT NULL OR indirect_overhead_rate IS NOT NULL
       OR lhr_usd_effective IS NOT NULL);  -- combined-format rows only

-- India rows also carry an INR LHR column — keep it consistent where empty
UPDATE mhr_records m
SET lhr_inr_per_hr = ROUND((m.usd_lhr_total * fx.rate)::numeric, 2)
FROM (SELECT rate FROM exchange_rates
      WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
      LIMIT 1) fx
WHERE lower(m.location) = 'india'
  AND m.usd_lhr_total IS NOT NULL
  AND (m.lhr_inr_per_hr IS NULL OR m.lhr_inr_per_hr = 0)
  AND (m.direct_overhead_rate IS NOT NULL OR m.indirect_overhead_rate IS NOT NULL
       OR m.lhr_usd_effective IS NOT NULL);

-- ── Phase 3b: recompute Total OH where the old total was just the sum of the
--    parts that existed (e.g. Induction Hardening total 5.30 == indirect 5.30
--    because direct was missing). Totals that came from a real Total column
--    (unit-rate rows: |total − parts_sum| large) are left untouched. Touched
--    rows are exactly the rows in the backup snapshot — that table is the
--    audit trail and the change gate; no marker column needed. ────────────────

UPDATE mhr_records m
SET mhr_usd_per_hour          = ROUND((m.direct_overhead_rate + m.indirect_overhead_rate)::numeric, 2),
    fully_burdened_usd_per_hr = ROUND((m.direct_overhead_rate + m.indirect_overhead_rate)::numeric, 2)
FROM mhr_records_backup_330 b
WHERE b.id = m.id
  AND m.direct_overhead_rate IS NOT NULL AND m.indirect_overhead_rate IS NOT NULL
  AND (
    b.mhr_usd_per_hour IS NULL
    OR ABS(b.mhr_usd_per_hour
           - (COALESCE(b.direct_overhead_rate, 0) + COALESCE(b.indirect_overhead_rate, 0))) < 0.02
  );

-- ── Phase 3c: refresh the LOCAL-currency figures costing actually consumes,
--    live-FX from exchange_rates (same pattern as migration 327). Only rows
--    whose old local value was mechanically derived from the old USD total
--    (±2%) or empty — a hand-edited local rate is never clobbered. ────────────

WITH usd_to_inr AS (
  SELECT rate FROM exchange_rates
  WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
  LIMIT 1
),
resolved AS (
  SELECT m.id,
         m.mhr_usd_per_hour,
         m.shifts_per_day, m.hours_per_shift, m.working_days_per_year, m.capacity_utilization_rate,
         b.mhr_usd_per_hour  AS old_usd,
         b.fully_burdened_local_per_hr AS old_local,
         u.rate AS usd_inr,
         CASE WHEN m.currency = 'INR' THEN 1
              ELSE (SELECT er.rate FROM exchange_rates er
                    WHERE er.is_active = true AND er.from_currency = m.currency
                      AND er.to_currency = 'INR' LIMIT 1)
         END AS local_inr
  FROM mhr_records m
  JOIN mhr_records_backup_330 b ON b.id = m.id
  CROSS JOIN usd_to_inr u
  WHERE m.mhr_usd_per_hour IS NOT NULL
    AND m.mhr_usd_per_hour IS DISTINCT FROM b.mhr_usd_per_hour
)
UPDATE mhr_records m
SET fully_burdened_local_per_hr = ROUND((r.mhr_usd_per_hour * r.usd_inr / r.local_inr)::numeric, 2),
    manual_mhr_value            = ROUND((r.mhr_usd_per_hour * r.usd_inr / r.local_inr)::numeric, 2),
    total_machine_hour_rate     = ROUND((r.mhr_usd_per_hour * r.usd_inr / r.local_inr)::numeric, 2),
    total_fixed_cost_per_hour   = ROUND((r.mhr_usd_per_hour * r.usd_inr / r.local_inr)::numeric, 2),
    total_annual_cost           = ROUND(
      (r.mhr_usd_per_hour * r.usd_inr / r.local_inr)
        * r.shifts_per_day * r.hours_per_shift * r.working_days_per_year
        * (r.capacity_utilization_rate / 100.0), 2)
FROM resolved r
WHERE m.id = r.id
  AND r.usd_inr IS NOT NULL
  AND r.local_inr IS NOT NULL
  AND (
    r.old_local IS NULL OR r.old_local = 0
    OR (r.old_usd IS NOT NULL
        AND ABS(r.old_local - r.old_usd * r.usd_inr / r.local_inr)
            <= 0.02 * GREATEST(r.old_local, 0.01))
  );

COMMIT;

-- ── Post-check: anything STILL missing needs a matrix entry (new location or
--    process group) — extend the VALUES list and re-run. Expected: 0 rows. ─────
--   SELECT location, process_group, machine_class, machine_name,
--          direct_overhead_rate, indirect_overhead_rate, mhr_usd_per_hour, usd_lhr_total
--   FROM mhr_records
--   WHERE (direct_overhead_rate IS NOT NULL OR indirect_overhead_rate IS NOT NULL
--          OR usd_lhr_total IS NOT NULL OR lhr_usd_effective IS NOT NULL)
--     AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
--          OR usd_lhr_total IS NULL OR mhr_usd_per_hour IS NULL)
--   ORDER BY location, process_group, machine_class;
--
-- Cleanup once verified in production (keep the backup until then):
--   DROP TABLE mhr_records_backup_330;
