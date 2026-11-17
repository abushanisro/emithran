-- ============================================================================
-- Migration 1061: India twin machines carry their own labour rate in usd_lhr_total
-- ============================================================================
-- Migrations 1044, 1047 and 1049 (and the die casting India rows before them) cloned each USA machine row at India
-- rates: they set the machine hour rate and usd_labor_rate_per_hr to the India values of
-- memory/Countries data/India_XML_Data_.csv, but copied usd_lhr_total from the USA row. usd_lhr_total is the labour
-- the machine selector (machine-selection/selector.ts) and the secondary processes read, so an India forging, die
-- casting or investment casting machine chosen there charged the USA operator: 29.95 to 57.19 USD/hr instead of
-- 1.65 to 2.99.
--
-- Each such row's usd_lhr_total becomes its own usd_labor_rate_per_hr (the India rate of its wage grade, from memory/).
-- Only India rows of the three groups the twin migrations wrote, and only where the two disagree; a row with no
-- usd_labor_rate_per_hr is left alone. Idempotent.
-- Verify: SELECT process_group, count(*) FROM mhr_records WHERE location = 'India'
--   AND usd_labor_rate_per_hr IS NOT NULL AND usd_lhr_total IS DISTINCT FROM usd_labor_rate_per_hr GROUP BY 1;  -- expect no rows.
-- ============================================================================

UPDATE mhr_records
SET usd_lhr_total = usd_labor_rate_per_hr,
    updated_at = now()
WHERE location = 'India'
  AND process_group IN ('Forging', 'Die Casting', 'Casting Investment')
  AND usd_labor_rate_per_hr IS NOT NULL
  AND usd_lhr_total IS DISTINCT FROM usd_labor_rate_per_hr;
