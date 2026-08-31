-- ============================================================================
-- Migration 606: Correct mis-tagged machine_class='press_brake' rows
--
-- Root-caused 2026-08-30/31 from a live bug report + direct diagnostic query
-- (backend/migrations/scripts/check_press_brake_full_pool.sql): a real Bend
-- Brake process line showed candidates "Aida UMX-600" (selected, ⭐) and
-- "Aida UMX-800" alongside the one genuine bend brake, "11010
-- (Heller-hydraulic)" (marked cheapest but not selected). Confirmed live:
-- mhr_records.machine_class for both Aida machines is literally the string
-- 'press_brake' — a DATA problem, not a keyword-matching problem.
-- classifyMachineRecord()'s Tier 0 trusts machine_class directly whenever it
-- already holds a canonical value, so this was never going through Tier 2's
-- keyword matching at all — the earlier code fix (narrowing press_brake's
-- MACHINE_REGISTRY keywords, same commit) does not touch these rows.
--
-- The follow-up full-pool diagnostic (checking every USA row tagged
-- machine_class='press_brake') found the true scope: 42 rows total, of which
-- only 16 are real Bend Press Brake category machines (verified against
-- machine_library.json's own "Bend Press Brake" category — 11010/15010/18510
-- Heller-hydraulic, Autobrake 2000, Bend Brake -800/1500/2500kN Press Force,
-- Default Bend Brake, FBD1253-NT, HFE2204, HG-1303/2204/5020/8025, SPH-30C/
-- 60C). The other 26 are genuinely Progressive Die Press / Tandem Press /
-- Standard Press family machines (CLAUDE.md's own documented "unwired
-- placeholders" — no real cost engine or registered MachineClass exists for
-- this family yet) that were mistakenly tagged 'press_brake' at import time,
-- silently corrupting the REAL, currently-active Bend Brake pool for every
-- part quoted since (created_at shows this happened in the initial 2026-08-22
-- through 2026-08-23 bulk seeding, not something introduced this session).
--
-- Fix: set machine_class = NULL for these 26 mis-tagged rows (never invent an
-- unregistered class value like 'progressive_die_press' just to have
-- something non-NULL — no real engine exists for that family yet, so NULL
-- honestly reflects "not currently classified/selectable for any process",
-- matching this app's own established convention for genuinely unclassified
-- machines). Matched by machine_class='press_brake' AND machine_name, across
-- ALL locations (not just USA) — every one of these 26 names is unambiguous
-- on its own (no real bend brake is ever named "Aida UMX-600" or
-- "Progressive Die Press - 5,000kN Press Force"), so this correctly reaches
-- the same mis-tagging wherever it was seeded (India/China/Mexico/etc.),
-- without needing a separate migration per location.
--
-- The HR Rates admin page's "Progressive Die Press (26)" grouping is
-- unaffected by this change — confirmed it already displays these rows
-- correctly grouped under that real category name today (despite the wrong
-- machine_class), meaning that page's category grouping reads a different,
-- already-correct field, not machine_class.
-- ============================================================================

UPDATE mhr_records
SET machine_class = NULL
WHERE machine_class = 'press_brake'
  AND machine_name IN (
    'Aida SMX-0-L2-3000', 'Aida SMX-0-L2-4000', 'Aida SMX-0-L2-5000', 'Aida SMX-0-L2-6000',
    'Aida UMX-1100', 'Aida UMX-600', 'Aida UMX-800',
    'Bliss - B-35',
    'Default Press',
    'Niagara - E511B',
    'Progressive Die Press - 1,500kN Press Force',
    'Progressive Die Press - 10,000kN Press Force',
    'Progressive Die Press - 3,000kN Press Force',
    'Progressive Die Press - 5,000kN Press Force',
    'Progressive Die Press - 7,000kN Press Force',
    'Schuler 1150 Ton', 'Schuler A2/200 - 360', 'Schuler TSD 2000',
    'United Power SHD-220 Ton', 'United Power SHD-400 Ton', 'United Power SHD-666 Ton',
    'United Power SHS-166 Ton', 'United Power SHS-666 Ton',
    'United Power THD-137 High Speed', 'United Power THD-333 High Speed', 'United Power THD-66 High Speed'
  );

-- Verification:
-- SELECT machine_name, machine_class, location FROM mhr_records
--   WHERE machine_name IN ('Aida UMX-600', 'Aida UMX-800', 'Schuler 1150 Ton')
--   ORDER BY machine_name, location;
-- Expect machine_class = NULL for all rows.
--
-- SELECT COUNT(*) FROM mhr_records WHERE machine_class = 'press_brake';
-- Expect only the 16 real Bend Press Brake machines (× however many
-- locations have been seeded) remain.
