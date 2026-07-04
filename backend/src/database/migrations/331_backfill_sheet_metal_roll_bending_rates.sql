-- Migration 331: Backfill the process groups migration 330's matrix missed —
-- Sheet metal / Roll Bending (all "-" Direct/Indirect OH, Total stored as 0.00)
-- and the "Default Material Stock" placeholder rows (missing every field).
--
-- Why 330 skipped them:
--   1. Its benchmark matrix had no 'Sheet metal' process-group entries.
--   2. The Material Stock rows have NO combined-format column populated at all
--      (skill rate is also "-"), so 330's row signature excluded them; they are
--      matched here explicitly by machine_name instead.
--
-- Roll-bending values are SIZE-TIERED — one flat rate for both a 1.5 m Knuth
-- and a 12 m Bertsch would be pseudo-data. Direct OH = drive energy + straight-
-- line depreciation + consumables (India industrial power ~$0.10/kWh; USA/China
-- ~$0.08; Mexico ~$0.11; France ~$0.15; Germany ~$0.19 — IEA Electricity 2025,
-- GlobalPetrolPrices):
--   SMALL  (Knuth KRB/KRM, Faccin ASI/M 15xx — ≤1.6 m light rolls):
--          ~22 kW drive + ~$60k machine  → India ≈ $3.50/hr
--   MID    (Faccin 20xx/25xx, Bertsch 25-, benders <200 mm roll dia):
--          ~45 kW + ~$200k               → India ≈ $8.50/hr
--   LARGE  (Bertsch 37/50/75, 9000/12200 mm beds, roll dia ≥200 mm):
--          ~90 kW + ~$600k               → India ≈ $20.00/hr
-- Skill rates anchor to the sheet's own India sheet-metal scale (roll bending
-- rows already carry $2.30; laser/press $1.73) — NOT generic country averages —
-- scaled to other locations by the verified labor-cost ratios used in 330
-- (BLS ECEC Q2-2025, Eurostat 2025, China Briefing 2025).
--
-- Rollback: mhr_records_backup_331 (same pattern as 330). Idempotent: every
-- fill is NULL-guarded; re-running changes nothing.
--
-- Preview:
--   SELECT location, process_group, machine_class, machine_name,
--          direct_overhead_rate, indirect_overhead_rate, mhr_usd_per_hour, usd_lhr_total
--   FROM mhr_records
--   WHERE (process_group ILIKE '%sheet%' OR machine_name ILIKE '%material stock%')
--     AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
--          OR usd_lhr_total IS NULL OR COALESCE(mhr_usd_per_hour, 0) = 0)
--   ORDER BY location, machine_class, machine_name;

BEGIN;

-- ── Phase 0: rollback snapshot ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mhr_records_backup_331 AS
SELECT * FROM mhr_records
WHERE (process_group ILIKE '%sheet%' OR machine_name ILIKE '%material stock%')
  AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
       OR usd_lhr_total IS NULL OR lhr_usd_effective IS NULL
       OR COALESCE(mhr_usd_per_hour, 0) = 0);

-- ── Phase 1: size-tiered Roll Bending + generic sheet-metal fill ──────────────
-- name_pat is a case-insensitive regex ('' matches every name). Most specific
-- match wins: large(4) > small(3) > roll-bending mid(2) > sheet-metal generic(1).

WITH matrix(loc, class_pat, name_pat, specificity, d_oh, i_oh, lhr) AS (
  VALUES
  -- ── LARGE plate rolls ──
  ('india',   '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 20.00, 3.00,  2.30),
  ('china',   '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 18.00, 3.60, 10.40),
  ('mexico',  '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 21.00, 3.30,  6.25),
  ('usa',     '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 19.00, 4.50, 35.00),
  ('germany', '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 32.00, 6.00, 37.00),
  ('france',  '%roll%bend%', 'bertsch\s*(37|50|75)-|(9000|12200)\s*mm|x\s*[2-9]\d\d\s*mm\s*roll\s*diameter', 4, 27.50, 5.40, 33.50),
  -- ── SMALL light rolls ──
  ('india',   '%roll%bend%', 'knuth|asi/m\s*15',  3,  3.50, 1.20,  2.30),
  ('china',   '%roll%bend%', 'knuth|asi/m\s*15',  3,  3.20, 1.50, 10.40),
  ('mexico',  '%roll%bend%', 'knuth|asi/m\s*15',  3,  3.80, 1.40,  6.25),
  ('usa',     '%roll%bend%', 'knuth|asi/m\s*15',  3,  3.60, 1.90, 35.00),
  ('germany', '%roll%bend%', 'knuth|asi/m\s*15',  3,  6.00, 2.60, 37.00),
  ('france',  '%roll%bend%', 'knuth|asi/m\s*15',  3,  5.20, 2.30, 33.50),
  -- ── MID: every other roll bender ──
  ('india',   '%roll%bend%', '',                  2,  8.50, 1.80,  2.30),
  ('china',   '%roll%bend%', '',                  2,  7.80, 2.20, 10.40),
  ('mexico',  '%roll%bend%', '',                  2,  9.00, 2.00,  6.25),
  ('usa',     '%roll%bend%', '',                  2,  8.30, 2.80, 35.00),
  ('germany', '%roll%bend%', '',                  2, 14.00, 3.80, 37.00),
  ('france',  '%roll%bend%', '',                  2, 12.00, 3.40, 33.50),
  -- ── Generic sheet-metal fallback (any other sequence in the group still
  --    missing OH — e.g. future imports; skill anchored to the sheet's
  --    India laser/press level) ──
  ('india',   '%',           '',                  1,  6.00, 1.50,  2.00),
  ('china',   '%',           '',                  1,  5.50, 1.90, 10.40),
  ('mexico',  '%',           '',                  1,  6.40, 1.70,  6.25),
  ('usa',     '%',           '',                  1,  6.00, 2.40, 35.00),
  ('germany', '%',           '',                  1, 10.00, 3.30, 37.00),
  ('france',  '%',           '',                  1,  8.60, 2.90, 33.50)
),
targets AS (
  SELECT m.id, mx.d_oh, mx.i_oh, mx.lhr,
         ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY mx.specificity DESC) AS rn
  FROM mhr_records m
  JOIN matrix mx
    ON lower(m.location) = mx.loc
   AND (mx.class_pat = '%' OR COALESCE(m.machine_class, '') ILIKE mx.class_pat)
   AND (mx.name_pat = '' OR COALESCE(m.machine_name, '') ~* mx.name_pat)
  WHERE m.process_group ILIKE '%sheet%'
    AND m.machine_name !~* 'material stock'      -- handled in Phase 2
    AND m.machine_name !~* 'sq\.?\s?m|per\s?m2|m²' -- unit-rate rows keep their units
    AND (m.direct_overhead_rate IS NULL OR m.indirect_overhead_rate IS NULL
         OR m.usd_lhr_total IS NULL)
)
UPDATE mhr_records m
SET direct_overhead_rate   = COALESCE(m.direct_overhead_rate,   t.d_oh),
    indirect_overhead_rate = COALESCE(m.indirect_overhead_rate, t.i_oh),
    usd_lhr_total          = COALESCE(m.usd_lhr_total,          t.lhr),
    lhr_usd_effective      = COALESCE(m.lhr_usd_effective,      t.lhr)
FROM targets t
WHERE t.id = m.id AND t.rn = 1;

-- ── Phase 2: "Default Material Stock" placeholder rows ────────────────────────
-- Stores/handling step in the routing: crane/forklift energy share (direct),
-- warehouse space + inventory management (indirect), stores operator (skill).
-- Matched explicitly by name — these rows have NO combined-format signature.

WITH stock(loc, d_oh, i_oh, lhr) AS (
  VALUES
  ('india',   0.50, 1.50,  1.50),
  ('china',   0.60, 2.20,  8.00),
  ('mexico',  0.65, 1.80,  4.50),
  ('usa',     0.80, 2.60, 25.00),
  ('germany', 1.10, 3.40, 27.00),
  ('france',  0.95, 3.00, 24.50)
)
UPDATE mhr_records m
SET direct_overhead_rate   = COALESCE(m.direct_overhead_rate,   s.d_oh),
    indirect_overhead_rate = COALESCE(m.indirect_overhead_rate, s.i_oh),
    usd_lhr_total          = COALESCE(m.usd_lhr_total,          s.lhr),
    lhr_usd_effective      = COALESCE(m.lhr_usd_effective,      s.lhr)
FROM stock s
WHERE lower(m.location) = s.loc
  AND m.machine_name ~* 'material stock'
  AND (m.direct_overhead_rate IS NULL OR m.indirect_overhead_rate IS NULL
       OR m.usd_lhr_total IS NULL);

-- ── Phase 3a: LHR base/burden split for rows filled above (72/28, as in 330) ──

UPDATE mhr_records m
SET usd_lhr_base   = ROUND((m.usd_lhr_total * 0.72)::numeric, 2),
    usd_lhr_burden = ROUND((m.usd_lhr_total - ROUND((m.usd_lhr_total * 0.72)::numeric, 2))::numeric, 2)
FROM mhr_records_backup_331 b
WHERE b.id = m.id
  AND m.usd_lhr_total IS NOT NULL
  AND m.usd_lhr_base IS NULL AND m.usd_lhr_burden IS NULL;

UPDATE mhr_records m
SET lhr_inr_per_hr = ROUND((m.usd_lhr_total * fx.rate)::numeric, 2)
FROM mhr_records_backup_331 b,
     (SELECT rate FROM exchange_rates
      WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
      LIMIT 1) fx
WHERE b.id = m.id
  AND lower(m.location) = 'india'
  AND m.usd_lhr_total IS NOT NULL
  AND (m.lhr_inr_per_hr IS NULL OR m.lhr_inr_per_hr = 0);

-- ── Phase 3b: Total OH — these rows stored 0.00 (not NULL), so recompute where
--    the old total was 0/NULL or was mechanically the sum of the old parts. ────

UPDATE mhr_records m
SET mhr_usd_per_hour          = ROUND((m.direct_overhead_rate + m.indirect_overhead_rate)::numeric, 2),
    fully_burdened_usd_per_hr = ROUND((m.direct_overhead_rate + m.indirect_overhead_rate)::numeric, 2)
FROM mhr_records_backup_331 b
WHERE b.id = m.id
  AND m.direct_overhead_rate IS NOT NULL AND m.indirect_overhead_rate IS NOT NULL
  AND (
    COALESCE(b.mhr_usd_per_hour, 0) = 0
    OR ABS(b.mhr_usd_per_hour
           - (COALESCE(b.direct_overhead_rate, 0) + COALESCE(b.indirect_overhead_rate, 0))) < 0.02
  );

-- ── Phase 3c: refresh the LOCAL-currency figures costing consumes (live FX,
--    same gates as 330: only mechanically-derived or empty local values). ──────

WITH usd_to_inr AS (
  SELECT rate FROM exchange_rates
  WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
  LIMIT 1
),
resolved AS (
  SELECT m.id,
         m.mhr_usd_per_hour,
         m.shifts_per_day, m.hours_per_shift, m.working_days_per_year, m.capacity_utilization_rate,
         b.mhr_usd_per_hour AS old_usd,
         b.fully_burdened_local_per_hr AS old_local,
         u.rate AS usd_inr,
         CASE WHEN m.currency = 'INR' THEN 1
              ELSE (SELECT er.rate FROM exchange_rates er
                    WHERE er.is_active = true AND er.from_currency = m.currency
                      AND er.to_currency = 'INR' LIMIT 1)
         END AS local_inr
  FROM mhr_records m
  JOIN mhr_records_backup_331 b ON b.id = m.id
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
    OR (r.old_usd IS NOT NULL AND r.old_usd > 0
        AND ABS(r.old_local - r.old_usd * r.usd_inr / r.local_inr)
            <= 0.02 * GREATEST(r.old_local, 0.01))
  );

COMMIT;

-- ── Post-check (expected: 0 rows) ─────────────────────────────────────────────
--   SELECT location, process_group, machine_class, machine_name,
--          direct_overhead_rate, indirect_overhead_rate, mhr_usd_per_hour, usd_lhr_total
--   FROM mhr_records
--   WHERE (direct_overhead_rate IS NOT NULL OR indirect_overhead_rate IS NOT NULL
--          OR usd_lhr_total IS NOT NULL OR lhr_usd_effective IS NOT NULL)
--     AND (direct_overhead_rate IS NULL OR indirect_overhead_rate IS NULL
--          OR usd_lhr_total IS NULL OR COALESCE(mhr_usd_per_hour, 0) = 0)
--   ORDER BY location, process_group, machine_class;
--
-- Cleanup once verified in production:
--   DROP TABLE mhr_records_backup_331;
