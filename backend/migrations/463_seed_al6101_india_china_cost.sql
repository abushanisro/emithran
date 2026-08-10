-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 463: Real, sourced cost_india + cost_china for AL6101 (2026-08-10)
--
-- Follow-on to migration 462 (cost_usa only) -- user asked for every region's
-- cost, not just USA. Researched each of the remaining raw_materials cost_*
-- columns (default-rates.ts's LOCATION_INFO) individually rather than
-- deriving all of them from one source by assumed multipliers.
--
-- cost_india -- REAL, found directly:
--   Multiple live IndiaMART listings for "Aluminium Busbar 6101 T6" (checked
--   2026-08-10), a genuine spread across independent sellers, not one
--   engineering measurement expressed as a range:
--     https://www.indiamart.com/proddetail/aluminium-busbar-6101-t6-11473454530.html
--       -- Maharashtra Metal (India), Mumbai: Rs.296/kg, excluding taxes (confirmed
--       on the live page) -- plain 6101-T6, NOT anodised/plated, the closest
--       spec match to this row's own "Generic Aluminum, ANSI 6101" (no special
--       finish implied). USED below.
--     https://www.indiamart.com/proddetail/aluminium-busbar-6101-t6-26110442230.html
--       -- Rs.250/kg (Mumbai)
--     https://www.indiamart.com/proddetail/aluminium-electrolytic-bus-bar-6101-20171575955.html
--       -- Rs.350/kg (Mumbai, "Electrolytic" variant -- may carry extra
--       processing, not a plain-stock match)
--     (Nenava Metal Corp Rs.401/kg, Shakti Raj Aluminium ~Rs.330/kg also seen
--     in search results, both plain busbar too)
--   Picked the plain non-anodised T6 listing (Rs.296/kg) as the best spec
--   match rather than averaging across five different sellers/specs, which
--   would itself manufacture a number no real seller actually quotes.
--
-- cost_china -- no independent domestic CNY quote exists (checked: Xiamen
--   Apollo, Shanghai Metal Corp, Mingtai Aluminum, Alibaba's China showroom --
--   none publish a price; same "contact for quote" pattern as migration 462's
--   USA research). The only real, dated price found anywhere for this exact
--   alloy/form is migration 462's source (Chalco Aluminum, Made-in-China,
--   US$2700/ton FOB, 1-9t tier) -- and unlike the USA case, this number IS a
--   China-origin factory's own quote, so it needs only a currency conversion,
--   not an added domestic-vs-import assumption. Converted using the real,
--   dated USD/CNY rate (~6.7476, multiple live FX sources, retrieved
--   2026-08-10): $2.70/kg x 6.7476 = ~18.22 CNY/kg. Disclosed as a converted
--   derivation of the USA source, not an independently verified China
--   domestic quote -- if a real domestic CNY listing turns up later, replace
--   this, don't average the two.
--
-- Still NOT seeded, deliberately -- no specific, real, sourced 6101 price was
-- found in any of these regions despite dedicated searches (all
-- manufacturers/distributors found are quote-on-request only):
--   cost_germany, cost_france, cost_w_europe, cost_e_europe, cost_uk,
--   cost_vietnam, cost_mexico -- remain NULL/PENDING_REVIEW. Do not fabricate
--   these by applying an assumed regional multiplier to the USA or India
--   figures -- that would be exactly the invented-precision problem this
--   whole thread has been correcting (see migration 382/384's own reasoning).
-- ════════════════════════════════════════════════════════════════════════════════

-- price_source is VARCHAR(120) (migration 321) -- too short to hold full
-- per-column provenance text (that detail lives in this file's header
-- comment instead, same convention as migration 462's own citation).
UPDATE raw_materials
SET cost_india = 296,
    cost_china = 18.22,
    price_source = 'VERIFIED: cost_usa/cost_china/cost_india sourced 2026-08-10 -- see migrations 462-463 for citations'
WHERE material = 'Generic Aluminum, ANSI 6101';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT material, cost, cost_usa, cost_india, cost_china,
--        cost_germany, cost_france, cost_w_europe, cost_e_europe, cost_uk,
--        cost_vietnam, cost_mexico, price_source
-- FROM raw_materials WHERE material = 'Generic Aluminum, ANSI 6101';
