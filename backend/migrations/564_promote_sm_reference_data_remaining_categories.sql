-- ============================================================================
-- Migration 564: Promote remaining machine_library categories into mhr_records
--
-- sm_reference_data (migrations 505-508) already holds all 281 machines
-- across all 15 machine_library.csv categories, staged losslessly in `raw`.
-- Only 6 categories with a real cost engine (fiber_laser, press_brake,
-- waterjet, turret_punch, deburring, co2_laser/laser) have ever had
-- mhr_records rows individually field-backfilled with cost-engine capability
-- (migrations 509/510/532/537).
--
-- CORRECTION (post-run, see migration 565's header): this migration's
-- premise that "the other ~9 categories have zero mhr_records rows" was
-- wrong — live data showed 257 of 281 machines already had a matching
-- mhr_records row from an earlier bulk import, across all 15 categories,
-- not just the 6 with a cost engine. This migration's actual effect on the
-- live DB was promoting only the machines with NO existing match at all
-- (verified: 0 rows inserted, since even those turned out to already exist
-- or be one of the 24 ambiguous-named rows migration 565 handles). Kept
-- as-is rather than rewritten, since the dedup logic itself is correct and
-- still the right migration to run first in a from-scratch environment
-- where sm_reference_data exists but mhr_records doesn't yet have these
-- rows.
--
-- Per user decision (HR Rates/MHR cleanup initiative): promote every
-- category, not just the 6 with a cost engine. machine_class is left NULL
-- for categories with no CATEGORY_TO_MACHINE_CLASS mapping (see
-- memory/sheetmetal/machine/build-mhr-import.mjs) — an honest capability
-- gap, never a fabricated size-tier. Per-category capability-column mapping
-- (max_tonnage, max_x/y/z_mm, etc.) is deliberately NOT attempted here — that
-- is genuinely category-specific work, same one-category-at-a-time
-- discipline as migrations 509/510/532, left for a later pass.
--
-- Dedup: matches migration 537's own discipline — case-insensitive exact
-- machine-name match, ambiguous names (same name in >1 sm_reference_data
-- row) skipped rather than guessed. Also skips any name already present in
-- mhr_records (covers the 6 already-promoted categories automatically,
-- without needing to enumerate categories at all).
--
-- Ownership: user_id = NULL, organization_id = NULL — reusing the existing,
-- live "true global/benchmark row" pattern (13 such rows already exist,
-- documented in .claude/plans/delegated-gliding-swan.md and supported by
-- migration 544's org_select_own_and_global policy's dedicated
-- `(organization_id IS NULL AND user_id IS NULL)` branch). This is reusing
-- an established pattern, not inventing new semantics or hardcoding a real
-- person's UUID for data that isn't actually theirs.
--
-- Rate honesty: direct_overhead_rate/indirect_overhead_rate/usd_lhr_total
-- are the real CSV figures (direct/indirect overhead + labor rate), each
-- tagged direct_overhead_source/indirect_overhead_source/labor_rate_source
-- = 'benchmark'. is_manual_entry = true with manual_mhr_value = direct +
-- indirect overhead (the real machine-hour rate) so the UI displays this
-- real figure directly instead of running it through calculateMHR()'s full
-- depreciation/rent/electricity waterfall using fabricated generic defaults
-- for fields we have no real data for (rent, footprint, admin/profit %).
-- ============================================================================

DO $$
DECLARE
  matched_count      INTEGER;
  ambiguous_count     INTEGER;
  already_present_count INTEGER;
  total_ref_machines  INTEGER;
BEGIN
  WITH name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  unambiguous AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt = 1
  ),
  to_promote AS (
    SELECT u.key, u.raw
    FROM unambiguous u
    WHERE NOT EXISTS (
      SELECT 1 FROM mhr_records mr WHERE lower(mr.machine_name) = lower(u.raw->>'name')
    )
  )
  INSERT INTO mhr_records (
    user_id, organization_id, location, commodity_code, process_group, machine_class,
    machine_name, machine_description, manufacturer_country, machine_price_usd,
    landed_machine_cost, is_manual_entry, manual_mhr_value, total_machine_hour_rate,
    fully_burdened_local_per_hr,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    capacity_utilization_rate, accessories_cost_percentage, installation_cost_percentage,
    payback_period_years, interest_rate_percentage, insurance_rate_percentage,
    machine_footprint_sqm, rent_per_sqm_per_month, maintenance_cost_percentage,
    power_kwh_per_hour, electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage,
    power_kw, currency, currency_symbol,
    direct_overhead_rate, indirect_overhead_rate, usd_lhr_total,
    direct_overhead_source, indirect_overhead_source, labor_rate_source,
    economics_version, economics_updated_at,
    capability_source, benchmark_source_key,
    benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr, benchmark_labor_rate_usd_hr
  )
  SELECT
    NULL, NULL,
    'USA', 'Sheet Metal', 'Sheet Metal', NULL,
    tp.raw->>'name',
    tp.raw->>'description',
    tp.raw->>'machine_manufacturer_location',
    NULLIF(tp.raw->>'machine_price_usd', '')::numeric,
    GREATEST(COALESCE(NULLIF(tp.raw->>'machine_price_usd', '')::numeric, 1), 1),
    true,
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    3, 8, 260, 0,
    95, 6, 20, 10, 8, 1, 0, 0, 6, 0, 0, 0, 0,
    NULLIF(tp.raw->>'machine_power_kw', '')::numeric,
    'USD', '$',
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric,
    'benchmark', 'benchmark', 'benchmark',
    1, NOW(),
    'benchmark', tp.key,
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric
  FROM to_promote tp;

  GET DIAGNOSTICS matched_count = ROW_COUNT;

  SELECT COUNT(*) INTO total_ref_machines FROM sm_reference_data WHERE category = 'machine';

  SELECT COUNT(*) INTO ambiguous_count
  FROM (
    SELECT lower(raw->>'name') AS n
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
    HAVING COUNT(*) > 1
  ) dup;

  SELECT COUNT(*) INTO already_present_count
  FROM sm_reference_data sr
  WHERE sr.category = 'machine'
    AND EXISTS (SELECT 1 FROM mhr_records mr WHERE lower(mr.machine_name) = lower(sr.raw->>'name'));

  RAISE NOTICE 'Migration 564: inserted % new mhr_records row(s) out of % staged machine_library rows (% already present, % ambiguous name(s) skipped).',
    matched_count, total_ref_machines, already_present_count, ambiguous_count;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
-- SELECT count(*) FROM mhr_records WHERE user_id IS NULL AND organization_id IS NULL;
-- SELECT location, machine_name, machine_class, direct_overhead_rate, indirect_overhead_rate, usd_lhr_total
--   FROM mhr_records WHERE benchmark_source_key IS NOT NULL AND machine_class IS NULL ORDER BY machine_name LIMIT 20;
