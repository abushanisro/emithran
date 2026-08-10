-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 411: Deburring / Turret Punch — real, distinct labour tiers (2026-08-06)
--
-- BUG: resolveLHRRates()'s LHR_GROUP (bom-items.service.ts) mapped BOTH
-- 'deburring' and 'turret_punch' straight into the 'Sheet Metal' labour group —
-- meaning Deburring and Turret Punch were always billed at the same labour rate
-- as Laser Cutting / Press Brake, on every part, in every location. This is why
-- a Direct Process Costs breakdown could show the identical Labour Rate for
-- Laser Cutting, Press Brake, Deburring, and Hole Extrusion — not a display bug,
-- the underlying lookup really was returning one shared number for all of them.
--
-- REAL DATA: memory/database/Combined_All_Countries_Database.json (the user's own
-- "Digital Factory 2026" source spreadsheet — same source migration 361 was built
-- from; India/China/Germany/USA/Mexico figures below match its "Skill Based Labor
-- Rate" column, filtered to Process Goup = 'Deburr' / 'Turret' respectively):
--
--   Deburr   (Manual Deburr / manual bench operations — genuinely a lower-skill
--             tier than sheet-metal fabrication machine operation):
--     USA $39.21  (vs Sheet Metal $46.67)
--     Germany €37.93  (vs €45.14)
--     China ¥9.30  (vs ¥11.27)
--     Mexico MX$6.88  (vs MX$8.34)
--   India excluded: the source data is ambiguous here (its "Manual operation"
--   Deburr rows are 1.73 — IDENTICAL to Sheet Metal's 1.73 — only the separately-
--   labeled "Automated operation" rows show 1.65; since this app's real Deburring
--   machine is manual, India's real number is the same as Sheet Metal's, so no
--   fix is needed/possible there).
--
--   Turret   (Turret Punch press operation):
--     USA $46.67, Germany €45.14, India ₹1.73 — all IDENTICAL to Sheet Metal in
--     the source data, so no behavioural change for these three; seeded anyway
--     so the group-rename below doesn't regress them to "no data".
--     China ¥13.01  (vs Sheet Metal ¥11.27) — real, distinct, now fixed.
--     Mexico MX$13.00  (vs MX$8.34) — real, distinct, now fixed.
--
-- GAP, DISCLOSED NOT GUESSED: UK / France / W. Europe / E. Europe / Vietnam have
-- no 'Deburr' or 'Turret' rows in the source data. After this migration + the
-- matching LHR_GROUP code change, Deburring and Turret Punch labour rate for
-- those 5 locations will show as "no data" (blank) instead of silently reusing
-- the Sheet Metal number — an honest gap, not a regression in accuracy; it was
-- never a verified number for those two operations to begin with.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
VALUES
-- Deburr — real, distinct, lower tier than Sheet Metal fabrication
('BM-US-DB', 'Manual Deburr Operator', '2026 all-in LHR — USA / Deburr (Combined_All_Countries_Database.json)',     39.21, 'USA',     'Deburr', 'USD', '$',   39.21),
('BM-DE-DB', 'Manual Deburr Operator', '2026 all-in LHR — Germany / Deburr (Combined_All_Countries_Database.json)', 37.93, 'Germany', 'Deburr', 'EUR', '€',   37.93),
('BM-CN-DB', 'Manual Deburr Operator', '2026 all-in LHR — China / Deburr (Combined_All_Countries_Database.json)',    9.30, 'China',   'Deburr', 'CNY', '¥',    9.30),
('BM-MX-DB', 'Manual Deburr Operator', '2026 all-in LHR — Mexico / Deburr (Combined_All_Countries_Database.json)',   6.88, 'Mexico',  'Deburr', 'MXN', 'MX$',  6.88),
-- Turret Punch — matches Sheet Metal for USA/Germany/India (seeded to avoid
-- regressing them to "no data"); genuinely distinct for China/Mexico
('BM-US-TU', 'Turret Punch Operator', '2026 all-in LHR — USA / Turret (Combined_All_Countries_Database.json)',      46.67, 'USA',     'Turret', 'USD', '$',   46.67),
('BM-DE-TU', 'Turret Punch Operator', '2026 all-in LHR — Germany / Turret (Combined_All_Countries_Database.json)',  45.14, 'Germany', 'Turret', 'EUR', '€',   45.14),
('BM-IN-TU', 'Turret Punch Operator', '2026 all-in LHR — India / Turret (Combined_All_Countries_Database.json)',     1.73, 'India',   'Turret', 'INR', '₹',    1.73),
('BM-CN-TU', 'Turret Punch Operator', '2026 all-in LHR — China / Turret (Combined_All_Countries_Database.json)',    13.01, 'China',   'Turret', 'CNY', '¥',   13.01),
('BM-MX-TU', 'Turret Punch Operator', '2026 all-in LHR — Mexico / Turret (Combined_All_Countries_Database.json)',   13.00, 'Mexico',  'Turret', 'MXN', 'MX$', 13.00)
ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT location, process_group, lhr FROM lhr_benchmark_rates
--   WHERE process_group IN ('Deburr', 'Turret') ORDER BY process_group, location;
-- Expect 4 Deburr rows (USA/Germany/China/Mexico) and 5 Turret rows
-- (USA/Germany/India/China/Mexico) — no UK/France/W. Europe/E. Europe/Vietnam.
