-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 458: Remove the false "2kW" claim from Salvagnini L3-30 machine
-- names (2026-08-09)
--
-- "Salvagnini L3-30" is a real Salvagnini fiber-laser model (confirmed via
-- Salvagnini's own product pages — the "30" is working-envelope size,
-- 3048mm, not power). Its real oscillator configurations are 3/4/6/8/
-- 8-E5/10 kW (Salvagnini L3/L3.G4 product pages) — dealer listings and
-- trade press (Shop Floor Lasers, Oct 2017) describe the L3-30 launch
-- specifically as a 6kW machine, positioned alongside Salvagnini's separate
-- 2/3/4kW product lines, never AS one of them.
--
-- Salvagnini DID once make a real 2kW fiber laser — the L1Xe (their first
-- fiber laser, ~2008-2009, per Laser Focus World's coverage of Salvagnini's
-- own engineering history) — but that is a different, older, unrelated
-- product line, not L3-30. "Salvagnini L3-30 2kW" pairs a real model name
-- with a real power rating that belongs to a DIFFERENT Salvagnini product —
-- an internally inconsistent name, not just an unverified one.
--
-- This is exactly why this quote's Laser Cutting line reports a genuine gap
-- (no verified power_kw on file) rather than trusting the "2kW" in the
-- name — that behavior is correct and stays unchanged by this migration.
-- What this migration fixes is the misleading LABEL itself: 5 rows across
-- 5 locations (India, USA, Germany, Mexico, China) all carry this same
-- wrong "2kW"/"2KW" claim, actively suggesting a verified spec that both
-- research passes this session confirmed cannot be real for this model.
--
-- This does NOT assign a real power_kw (still null — still genuinely
-- unverified; picking any of L3-30's real 3/4/6/8/8-E5/10kW configs here
-- would be exactly the "arbitrarily select a wattage" this session's
-- standing rule forbids). It only removes a demonstrably false claim from
-- the display name so nobody reading it mistakes "2kW" for a real spec.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET machine_name = 'Salvagnini L3-30 Fiber'
WHERE machine_name IN ('Salvagnini L3-30 2kW Fiber', 'Salvagnini L3-30 2KW Fiber')
  AND machine_class = 'fiber_laser';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, location, machine_name, power_kw FROM mhr_records
-- WHERE machine_name ILIKE '%Salvagnini L3-30%';
-- Expect: machine_name = 'Salvagnini L3-30 Fiber' for all 5 rows (India, USA,
-- Germany, Mexico, China), power_kw still NULL for every one.
