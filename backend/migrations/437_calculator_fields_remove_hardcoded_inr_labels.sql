-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 437: Remove hardcoded "(INR)" currency labels from calculator_fields
-- (2026-08-08)
--
-- Root cause: every calculator built in this app (25+ migration files under
-- migrations/calculators/) hardcodes 'INR'/'INR/hr'/'INR/Kg' as the `unit` and
-- bakes "(INR)"/"(INR/hr)"/"(INR/Kg)" into the `display_label` for every
-- rate/cost field — 'MHR per Hour', 'LHR per Hour', 'Machine Cost', 'Labour
-- Cost', 'Process Cost', 'Setup Cost', 'Total Process Cost', 'Material Price',
-- 'Scrap Price', etc. This is a STATIC label on a DYNAMIC value: the real
-- number that ends up in these fields is fed in per-request by whichever
-- real, location-resolved MHR/LHR rate the caller supplies (resolvePhysicsQuantity
-- in bom-items.service.ts) — for a USA-context part that's a real USD figure,
-- for an India-context part a real INR figure. The Calculators executor UI
-- (components/features/calculators/executor/CalculatorExecutor.tsx) renders
-- `unit`/`display_label` verbatim with no currency-context override, so it
-- literally displays "(INR)" next to what may be a genuinely correct USD
-- number — mislabeling every non-India calculation, not just a cosmetic issue.
--
-- Relabeling to "(USD)" instead would repeat the exact same mistake for every
-- India-context calculation — the fix is not "the other hardcoded currency,"
-- it's removing the false currency claim entirely, since NO static string can
-- correctly describe a value whose currency is decided per-request. The
-- dimensional suffix (/hr, /Kg) is kept — only the currency claim is dropped.
-- Numeric `default_value`s (e.g. the ubiquitous 91.6 MHR / 96.14 LHR
-- placeholders) are left untouched: they were never really "INR" in the
-- sense of a sourced rate, just an illustrative placeholder shown until a
-- real rate is fed in, and rescaling them to a guessed USD-equivalent number
-- would be a fabricated conversion, not a fix.
--
-- No calculator_id/version bump: this changes display metadata, not any
-- formula or field's semantic meaning (a resolvePhysicsQuantity gap/trace is
-- unaffected either way — see cost-breakdown.dto.ts's own convention that a
-- version bump is for formula/meaning changes).
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE calculator_fields
SET unit = '/hr',
    display_label = trim(regexp_replace(regexp_replace(display_label, '\(INR/hr\)', '', 'g'), '\s{2,}', ' ', 'g'))
WHERE unit = 'INR/hr';

UPDATE calculator_fields
SET unit = '/Kg',
    display_label = trim(regexp_replace(regexp_replace(display_label, '\(INR/Kg\)', '', 'g'), '\s{2,}', ' ', 'g'))
WHERE unit = 'INR/Kg';

UPDATE calculator_fields
SET unit = NULL,
    display_label = trim(regexp_replace(regexp_replace(display_label, '\(INR\)', '', 'g'), '\s{2,}', ' ', 'g'))
WHERE unit = 'INR';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT field_name, display_label, unit FROM calculator_fields
-- WHERE unit ILIKE '%INR%' OR display_label ILIKE '%INR%';
-- Expect 0 rows.
-- Spot-check one calculator's fields didn't lose meaning, only the currency claim:
-- SELECT field_name, display_label, unit, default_value FROM calculator_fields
-- WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Hole Extrusion (Burring)')
-- ORDER BY display_order;
