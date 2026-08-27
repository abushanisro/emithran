-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 380: Documents a session of root-cause fixes to the sheet-metal cost
-- engine (items 1-6 below are all application-code changes; this migration itself
-- only audits + repairs one confirmed, narrow data issue at the bottom — orphaned
-- raw_material_cost_records.material_id foreign keys). Recorded here so migration
-- history explains the "why" behind cost numbers changing after this deploy.
--
-- 1. resolveMaterialForFamily() (bom-items.service.ts) matched raw_materials purely
--    via tokenized fuzzy OR-ILIKE across `material`/`material_grade` — no exact-match
--    attempt first. Confirmed live: "Generic Aluminum - Honeycomb (Expanded 1)"
--    (real density 50 kg/m³) was resolving to an unrelated ~450-2700 kg/m³ row
--    instead, an 8-50x error in computed part weight with no warning. The tokenized
--    fallback also silently broke entirely for any grade containing "(", ")", or ","
--    (PostgREST's .or() filter treats those as its own grouping syntax) — e.g. the
--    literal "(Expanded 1)" in this material's own name. Fixed: exact case-insensitive
--    match on `material` then `material_grade` first; fuzzy tokenized match only as a
--    documented fallback, with special characters stripped from tokens so it can no
--    longer corrupt the filter.
-- 2. The same exact-match fix was applied to the shear-strength/UTS lookup, which had
--    an even narrower bug: it only ever queried `material_grade` (null for every
--    "Generic ..." seed row) using just the FIRST WORD of the grade string.
-- 3. Removed the hardcoded materialDensityKgM3 = 7850 (mild steel) fallback used when
--    no material match exists at all. Weight/nesting now correctly skip (0 kg) rather
--    than silently computing a fabricated weight from an unrelated material's density.
-- 4. sheet-metal-lookup.service.ts's getHandlingTime / getToolSetupTime /
--    getManualStrokeTime / getSamplingRate previously returned a bare number,
--    indistinguishable whether it came from real DB data or an internal FALLBACK_*
--    constant. All four now return { value, dataFound }, and bom-items.service.ts
--    pushes an explicit warning whenever dataFound is false, matching the pattern
--    getLaserParams already used. (All underlying tables are well-seeded — 17 to 478
--    rows each — so these fallbacks are edge-case-only, but were previously silent
--    when they did fire.)
-- 5. Press-brake cycle time (cost-engine.ts) had briefly been switched from real
--    per-bend stroke data (sm_lookup_manual_stroke, Table 4) to a flat, unvalidated
--    PRESS_BRAKE_SEC_PER_BEND constant (~25 sec/bend at 4mm) to fix an unrelated
--    display-mismatch bug. Cross-checked against the reference costing model
--    (Stamping_Bending_Calculator.md): the correct formula is real stroke time (Table
--    4) + one-time part load/unload (Table 2), not a flat per-bend constant — reverted
--    to the real-data formula, ~3-4x lower and consistent with the 6-30 sec/bend
--    industry range. The feature-breakdown display was unified to the same source so
--    it can no longer disagree with the cost total.
-- 6. mhr_records.fully_burdened_local_per_hr is machine + labour combined by design
--    (mhr.service.ts's calculateMHR). Both machine-rate resolvers (selector.ts's
--    pickRate, and the legacy fallback copy in bom-items.service.ts) were preferring
--    it over the pure total_machine_hour_rate/manual_mhr_value columns, and that rate
--    feeds eMithranTerms()'s mhrPerHr — a slot that formula ALWAYS separately adds its
--    own direct-labour term to. Any machine row where fully_burdened_local_per_hr was
--    genuinely computed via the labour-inclusive formula got labour counted twice.
--    Fixed to never read that column for this purpose (in both the backend resolvers
--    and lib/api/mhr.ts's resolveMhrUsdRate on the frontend).
--
-- Items (1)-(3) potentially affected auto-computed weight/cost display for any part
-- whose material match previously fell through to the fuzzy path or the 7850
-- default — those recompute live on next page load, nothing to backfill. Item (6)
-- potentially affected any process line using a machine whose
-- fully_burdened_local_per_hr was populated via the real formula — same, recomputes
-- live. Item (5) likewise recomputes live; already-SAVED process_cost_records.cycle_time
-- values are a separate stored INPUT field this migration does not touch (see the
-- app's own "recalculate from geometry" action for those). The audit/repair below is
-- the one exception — a confirmed, narrow data issue, not a recompute-on-load case.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Audit: raw_material_cost_records possibly hit by bug (1)/(2) ──────────────────
-- Flags rows whose linked raw_materials.id does NOT correspond to the exact-name
-- match now-available for the record's own stored material_name. Run against the
-- live DB ahead of writing this migration (2026-07-29): 4 of 19 active rows matched,
-- all under bom_item_id b0eac6f0-8d4e-4617-93b3-da2fb4be455f — and in every case the
-- currently-linked material_id does not exist in raw_materials AT ALL (confirmed via
-- direct lookup: 0 rows returned for those 3 ids). These are orphaned foreign keys —
-- the material row each was originally pointing to was deleted/re-seeded at some
-- point and the cost record's link was never refreshed — not a case of "maybe
-- correct, maybe not" ambiguity, so this migration repairs them directly below.
DO $$
DECLARE
  affected_count INTEGER;
  affected_list  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(
    format('  - record %s (bom_item %s): stored material_name=%L, linked material_id=%s, exact-match id=%s',
           r.id, r.bom_item_id, r.material_name, r.material_id, exact.id),
    E'\n'
  )
  INTO affected_count, affected_list
  FROM raw_material_cost_records r
  JOIN raw_materials exact
    ON lower(trim(exact.material)) = lower(trim(r.material_name))
  WHERE r.is_active = true
    -- material_id is character varying, not uuid — must cast exact.id to compare.
    AND (r.material_id IS NULL OR r.material_id <> exact.id::text);

  IF affected_count > 0 THEN
    RAISE NOTICE 'Audit: % active raw_material_cost_records row(s) have an exact-name material match that differs from their linked material_id:\n%',
      affected_count, affected_list;
  ELSE
    RAISE NOTICE 'Audit: no raw_material_cost_records rows found with a mismatched exact-name material match.';
  END IF;
END $$;

-- ── Repair: re-link orphaned material_id, refresh denormalized name/rate ──────────
-- Scoped deliberately narrow: only rows where the CURRENT material_id points to a
-- row that no longer exists at all (confirmed orphan, not "a different but still
-- valid material" — this migration does not touch those, since distinguishing
-- "wrong pick" from "legitimately different material with a similar name" isn't
-- safe to automate). Only material_id, material_name, and unit_cost are updated —
-- NOT total_cost / gross_material_cost / net_material_cost / calculation_breakdown,
-- since those are the output of the app's own 8-step cost formula (RawMaterialsSection
-- / raw-materials.service.ts) and re-deriving that in SQL risks introducing a fresh,
-- harder-to-spot error. Open each repaired record in the app (Direct Material Costs)
-- and hit Save once to let the real engine recompute the dependent cost fields.
UPDATE raw_material_cost_records r
SET
  material_id = exact.id::text,
  unit_cost   = COALESCE(exact.cost_usa, r.unit_cost),
  updated_at  = now()
FROM raw_materials exact
WHERE r.is_active = true
  AND lower(trim(exact.material)) = lower(trim(r.material_name))
  AND r.material_id IS NOT NULL
  -- material_id is character varying, not uuid — must cast cur.id to compare.
  AND NOT EXISTS (SELECT 1 FROM raw_materials cur WHERE cur.id::text = r.material_id);
