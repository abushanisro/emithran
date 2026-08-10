-- ===================================================================================
-- Migration 391: SECC regional cost (2026-07-31)
--
-- User supplied July-2026 desk research for SECC cost across 8 regions
-- (India, China, USA, France, Mexico, Germany, W. Europe, E. Europe). Two
-- tiers of confidence, both inserted, clearly distinguished:
--
-- TIER 1 -- material-specific, real (if informal) source:
--   India: cited to a live IndiaMart listing for SECC/SECE electrogalvanized
--     coil at Rs 105/kg, converted at a stated Rs 92/USD reference ->
--     $1.14/kg.
--   China: "Chinese suppliers quote SECC/electro-galvanized steel coils
--     around 750-1,100 USD/ton" -- a real quoted range for the actual
--     material. Midpoint used: (750+1100)/2 = 925 USD/ton = 0.93 USD/kg.
--
-- TIER 2 -- generic galvanized-coil category proxy, NOT SECC-specific:
--   USA, France, Mexico, Germany, W. Europe: the user's own research states
--     outright "No France-specific SECC price found" / "No Mexico-specific
--     SECC data" etc., and substitutes the SAME generic galvanized-coil
--     global band (1.05-1.30 USD/kg) across all five. Median used: 1.175.
--   E. Europe: qualitative "slightly below Western Europe" with no number
--     given. Median of the analogous 0.95-1.25 USD/kg band used: 1.10.
--   Per explicit user decision (asked directly, given the accuracy risk):
--     use these proxy medians rather than leave the item unpriced, since no
--     real SECC-specific quote exists for these regions. This is NOT the
--     same as silently fabricating -- it is visible, documented, and
--     reversible the moment a real quote exists for any of these regions.
--
-- price_source moves from PENDING_REVIEW to BENCHMARK (an existing
-- convention already used elsewhere in this table for informally-sourced,
-- non-firm-quote pricing).
--
-- Known follow-up (not fixed here, flagged separately): "country -> cost
-- column" resolution exists as 5+ independent, unsynchronized implementations
-- across the codebase (RawMaterialDialog.tsx x3, manufacturing-intelligence/
-- page.tsx, raw-material-cost.service.ts's PRICE_COL, bom-items.service.ts's
-- LOCATION_INFO), at least one of which (RawMaterialDialog.tsx) applies a
-- redundant INR-pivot currency conversion to values already in USD/kg. This
-- migration's values are correct as stored (USD/kg, per migration 350's
-- column comments); the display bug this may still cause is a separate,
-- larger cleanup.
-- ===================================================================================

UPDATE raw_materials
SET cost_india    = 1.14,
    cost_china    = 0.93,
    cost_usa      = 1.175,
    cost_france   = 1.175,
    cost_mexico   = 1.175,
    cost_germany  = 1.175,
    cost_w_europe = 1.175,
    cost_e_europe = 1.10,
    price_source  = 'BENCHMARK',
    price_version = 'Q3-2026',
    price_date    = '2026-07-31'
WHERE material = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)';

-- Verification:
-- SELECT material, cost, cost_india, cost_china, cost_usa, cost_france,
--        cost_mexico, cost_germany, cost_w_europe, cost_e_europe,
--        price_source, price_version, price_date
--   FROM raw_materials WHERE material = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)';

-- ── Refresh already-saved cost records ─────────────────────────────────────────
-- raw_material_cost_records.unit_cost is a frozen snapshot taken at save time
-- (confirmed: no DB trigger or read-time logic re-reads raw_materials after
-- creation). Without this, existing SECC cost records would still show
-- $0.000 unit cost even after the update above, since nothing re-triggers a
-- lookup unless the user re-selects the material in the picker dialog.
-- Scoped per-row to the country the record was actually saved under, using
-- the same country string values already in use by the app (confirmed via
-- the record checked while diagnosing this: country = 'USA').
UPDATE raw_material_cost_records r
SET unit_cost = CASE lower(r.country)
    WHEN 'india'    THEN 1.14
    WHEN 'china'     THEN 0.93
    WHEN 'usa'       THEN 1.175
    WHEN 'france'    THEN 1.175
    WHEN 'mexico'    THEN 1.175
    WHEN 'germany'   THEN 1.175
    WHEN 'w. europe' THEN 1.175
    WHEN 'w europe'  THEN 1.175
    WHEN 'e. europe' THEN 1.10
    WHEN 'e europe'  THEN 1.10
    ELSE r.unit_cost
  END
WHERE r.material_name = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)'
  AND r.is_active = true
  AND (r.unit_cost IS NULL OR r.unit_cost = 0)
  AND lower(r.country) IN ('india', 'china', 'usa', 'france', 'mexico', 'germany', 'w. europe', 'w europe', 'e. europe', 'e europe');

-- Verification:
-- SELECT id, bom_item_id, material_name, country, unit_cost, net_usage, total_cost
--   FROM raw_material_cost_records
--   WHERE material_name = 'Generic Steel, Cold Rolled Electrogalvanized (SECC)' AND is_active = true;
