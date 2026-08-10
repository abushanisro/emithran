-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 426: Real deburring machine options — Rotary, Vibratory, Wide Belt
-- (2026-08-07)
--
-- Follow-up to migration 425. Before that fix, machine_class='deburring' had
-- exactly two real options on file: "Manual Deburr" (bench) and "Deburring Cell"
-- (migration 361) — plus the misclassified ultrasonic cleaning tank now removed.
-- For a sheet-metal shop, that's a real, disclosed gap: genuine powered deburring
-- equipment (rotary brush machines, vibratory/tumbling finishers, wide-belt
-- sanders) is common and materially different in cost from a manual bench, but
-- had no options on file at all.
--
-- RESEARCH (WebSearch, Aug 2026) — real capital-cost anchors, no fabricated numbers:
--   - Rotary Deburring Machine: Alibaba listings $2,999-$26,500; China metal
--     deburring machines average ~$7,421; Made-in-China automatic stainless-steel
--     sheet-metal deburring machines $5,999-$12,000. Midpoint used: USD 8,000.
--   - Vibratory Deburring (tumbler/mass-finishing): shop-scale used units
--     $2,750-$9,900 (Almco VS-5, 5 cu ft, $9,900 — representative shop-scale
--     anchor); centrifugal barrel finishers (a related, higher-end variant)
--     $14,500+. Midpoint used: USD 6,500.
--   - Wide Belt Deburring Machine: China-made (630-1600mm belt width)
--     $7,999-$19,000; Timesavers (US premium brand) used equipment $8,500 (9",
--     small) to $92,500 (37", 2020, large). Midpoint used for a representative
--     mid-size (1000-1300mm) shop machine: USD 14,000.
--
-- No source publishes an actual hourly SHOP RATE for these machine types (only
-- capital/purchase cost) — the same gap migration 413 hit for deburring cycle
-- time. Deriving an hourly rate purely from equipment depreciation is
-- known-wrong for this table: migration 393 already found that every existing
-- bench/capital-tier row here (Deburring Cell, CMM Machine, ...) is priced as an
-- all-in shop rate (labour + facility + overhead + margin), not equipment-only —
-- pure depreciation math on these numbers is a tiny fraction of the real rate.
--
-- METHOD: log-linear capital-cost interpolation between this table's own two
-- already-verified 'deburring'-adjacent USA anchors — Deburring Cell (bench
-- tier, ~$1,500 equivalent capital, $14.13/hr) and CMM Machine/Quality-group
-- Zeiss Contura G2 (capital-equipment tier, ~$200,000, $65/hr) — then scaled to
-- every other location using THIS TABLE'S OWN CMM Machine cross-location ratio
-- (the closest existing analog for "globally-priced capital equipment blended
-- with local labour/overhead," already trusted for this table's other rows):
--   UK 0.877 · Germany 1.077 · France 0.923 · W.Europe 0.954 · E.Europe 0.431 ·
--   China 0.200 · India 0.123 · Vietnam 0.154 · Mexico 0.277
--
-- Sanity check (mirrors migration 393's own check): pure depreciation+energy on
-- the Wide Belt's USD 14,000 capital (8yr life, 70% OEE per this table's own
-- documented methodology, ~4,368 effective hr/yr, 3kW draw, USA $0.09/kWh) =
-- ~$0.40/hr depreciation + ~$0.27/hr energy ≈ $0.67/hr — a small fraction of the
-- $28.37/hr used below, consistent with how every other row in this table is
-- actually priced (not a red flag; matches the established pattern).
--
-- HONESTY: this is a reasoned estimate anchored to real capital-cost research
-- and this table's own existing verified rows, NOT an independently-sourced
-- shop rate for each machine/location (none exists publicly) — same disclosed-
-- estimate status as this table's other rows. A shop with its own real rate can
-- always override via HR Rates (mhr_records), which takes precedence over this
-- benchmark table.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref, machine_class) VALUES
-- Rotary Deburring Machine — USD 8,000 capital midpoint
('Rotary Deburring Machine', 'Sheet Metal', 'USA',       23.83, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'UK',        20.90, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'Germany',   25.66, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'France',    22.01, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'W. Europe', 22.73, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'E. Europe', 10.27, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'China',      4.77, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'India',      2.93, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'Vietnam',    3.67, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),
('Rotary Deburring Machine', 'Sheet Metal', 'Mexico',     6.60, 'Rotary brush deburring machine, ~$8,000 capital midpoint', 'deburring'),

-- Vibratory Deburring Machine — USD 6,500 capital midpoint
('Vibratory Deburring Machine', 'Sheet Metal', 'USA',       22.33, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'UK',        19.58, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'Germany',   24.05, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'France',    20.62, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'W. Europe', 21.29, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'E. Europe',  9.62, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'China',      4.47, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'India',      2.75, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'Vietnam',    3.44, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),
('Vibratory Deburring Machine', 'Sheet Metal', 'Mexico',     6.18, 'Vibratory tumbler/mass finisher, ~$6,500 capital midpoint', 'deburring'),

-- Wide Belt Deburring Machine — USD 14,000 capital midpoint (1000-1300mm belt)
('Wide Belt Deburring Machine', 'Sheet Metal', 'USA',       28.37, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'UK',        24.87, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'Germany',   30.55, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'France',    26.19, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'W. Europe', 27.05, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'E. Europe', 12.22, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'China',      5.67, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'India',      3.49, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'Vietnam',    4.36, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring'),
('Wide Belt Deburring Machine', 'Sheet Metal', 'Mexico',     7.86, 'Wide-belt sander, 1000-1300mm belt, ~$14,000 capital midpoint', 'deburring')
ON CONFLICT (machine_name, process_group, location) DO NOTHING;

-- ── Verification (informational) ───────────────────────────────────────────────
-- SELECT machine_name, location, mhr_usd, machine_class FROM mhr_benchmark_rates
--   WHERE machine_name IN ('Rotary Deburring Machine','Vibratory Deburring Machine','Wide Belt Deburring Machine')
--   ORDER BY machine_name, location;
-- Expected: 30 rows (3 machines x 10 locations), all machine_class='deburring'.
