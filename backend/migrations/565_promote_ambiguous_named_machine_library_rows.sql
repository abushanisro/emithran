-- ============================================================================
-- Migration 565: Promote the 24 previously-ambiguous machine_library rows
--
-- Migration 564 promoted every unambiguous sm_reference_data machine not yet
-- in mhr_records — but live data showed 257 of 281 machines were already
-- present from an earlier bulk import (not just the 6 cost-engine
-- categories, as this initiative's earlier audit assumed). The only real
-- gap turned out to be 24 machines whose display name collides with a
-- same-named machine in a DIFFERENT category — e.g. "Schuler 1150 Ton"
-- exists once under Progressive Die Press and once under Tandem Press.
-- Migration 537 already documented this exact ambiguity ("12 machine names
-- appear twice across different categories") and deliberately skipped them
-- rather than guess; migration 564 followed the same discipline.
--
-- Per user decision: promote both duplicate-named rows anyway, since they
-- ARE two distinct real catalog entries (a standalone press vs. the same
-- press integrated into a tandem line) — mhr_records has no unique
-- constraint on machine_name (migration 409's own finding), so nothing
-- blocks two rows sharing a display name. Dedup here is keyed on
-- sm_reference_data.key (format "category:name", always unique) instead of
-- name, so both duplicates get their own row rather than one blocking the
-- other. machine_description gets the source machine_category appended
-- (e.g. "... [Tandem Press]") so the two rows stay visually distinguishable
-- in the UI despite sharing a machine_name.
--
-- Same non-fabrication discipline as 564: machine_class stays NULL (no
-- CATEGORY_TO_MACHINE_CLASS mapping for these categories), capability
-- columns are left for a later, category-specific pass.
-- ============================================================================

DO $$
DECLARE
  inserted_count    INTEGER;
  total_ambiguous   INTEGER;
BEGIN
  WITH name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  ambiguous_rows AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt > 1
  ),
  to_promote AS (
    SELECT a.key, a.raw
    FROM ambiguous_rows a
    WHERE NOT EXISTS (
      SELECT 1 FROM mhr_records mr WHERE mr.benchmark_source_key = a.key
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
    CASE
      WHEN COALESCE(tp.raw->>'description', '') = '' THEN '[' || (tp.raw->>'machine_category') || ']'
      ELSE (tp.raw->>'description') || ' [' || (tp.raw->>'machine_category') || ']'
    END,
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

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT COUNT(*) INTO total_ambiguous
  FROM (
    SELECT lower(raw->>'name') AS n
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
    HAVING COUNT(*) > 1
  ) dup;

  RAISE NOTICE 'Migration 565: inserted % of % previously-ambiguous machine_library row(s), keyed by sm_reference_data.key instead of name.',
    inserted_count, total_ambiguous;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
-- SELECT machine_name, machine_description, benchmark_source_key
--   FROM mhr_records WHERE user_id IS NULL AND organization_id IS NULL
--   ORDER BY machine_name;
-- -- Expect pairs like "Schuler 1150 Ton" appearing twice, with
-- -- machine_description disambiguating "[Progressive Die Press]" vs "[Tandem Press]".
