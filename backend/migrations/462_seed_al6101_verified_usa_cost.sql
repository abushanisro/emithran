-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 462: Real, sourced cost_usa for AL6101 (2026-08-10)
--
-- Migration 382 correctly left cost NULL for "Generic Aluminum, ANSI 6101"
-- ("no verified market price for this specific alloy is available... an
-- unknown value is left unmatched/flagged for review rather than filled with
-- a guess") -- confirmed still true live: a real quote for this part showed
-- Unit Cost $0.000/kg (material cost $0.00) once the AL6101 alias-resolution
-- bug was fixed (see bom-items.service.ts's resolveMaterialForFamily), i.e.
-- the material now resolves to its real row/properties, it just has no price.
--
-- Research done to close that gap, narrowly:
--   - LME primary aluminum ingot spot (tradingeconomics.com / metalcharts.org,
--     retrieved 2026-08-10): ~$3.19-3.26/kg. Real and current, but this is
--     raw ingot commodity price, not a finished 6101-T6 extruded-bar price
--     (excludes alloying + extrusion + fabrication premium) -- NOT used here,
--     would understate real cost.
--   - OnlineMetals, Continental Steel, Metals Depot, Worthwill: all carry
--     6101 stock but publish no price (quote-on-request only, or blocked
--     access) -- checked, not assumed.
--   - Real, specific, dated, USABLE source found: Chalco Aluminum's listing
--     for 6101-T6 Aluminum Bus Bar on Made-in-China,
--     https://chalcoaluminum.en.made-in-china.com/product/EFRtJamjVgkq/China-6101-T6-Aluminum-Bus-Bar.html
--     (retrieved 2026-08-10): tiered FOB pricing, US$2,700/ton for 1-9 tons,
--     US$2,600/ton for 10+ tons. This part's real usage (~0.0017 kg/pc x 250
--     pc batch) is nowhere near 1 ton, so the applicable real tier is the
--     1-9 ton price: US$2,700/ton = $2.70/kg.
--
-- Scope, deliberately narrow:
--   - This is a China-origin FOB export price, not a domestic-USA delivered
--     quote (none was publicly found) -- the best real, alloy-and-form-
--     specific number available, not a perfect one. Recorded as such in
--     price_source rather than silently presented as a US domestic price.
--   - Sets cost_usa ONLY, not the generic `cost` column. resolveMaterialForFamily
--     (bom-items.service.ts) falls back to `cost_india ?? cost` and always
--     treats that fallback value as INR before converting -- writing a USD
--     figure into the generic `cost` column would make every OTHER location's
--     fallback silently misinterpret $2.70 as ₹2.70 (~$0.03), a ~85x
--     understatement. cost_india/cost_china/cost_germany/etc. stay NULL
--     (PENDING_REVIEW) -- no comparably specific real source was found for
--     those regions for this alloy; do not fabricate them by conversion.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE raw_materials
SET cost_usa = 2.70,
    price_source = 'VERIFIED: Chalco Aluminum 6101-T6 Bus Bar, Made-in-China listing, US$2700/ton (1-9t tier), retrieved 2026-08-10'
WHERE material = 'Generic Aluminum, ANSI 6101';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT material, cost, cost_usa, cost_india, currency, price_source
-- FROM raw_materials WHERE material = 'Generic Aluminum, ANSI 6101';
