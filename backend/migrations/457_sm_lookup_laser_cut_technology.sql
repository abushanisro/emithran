-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 457: Add laser_technology axis to sm_lookup_laser_cut (2026-08-09)
--
-- Root cause this closes: sm_lookup_laser_cut (migration 300/360) is keyed
-- purely by (material, thickness_mm, laser_power_w) — no technology column
-- at all. getLaserParams() picks the row with the NEAREST power to whatever
-- powerW it's given, with zero awareness of laser technology.
--
-- Every row currently in this table is FIBER-laser data — confirmed by
-- migration 448's own comment ("a 6kW fiber laser is a common mid-range
-- shop machine") describing the exact table this migration seeded. There is
-- no CO2 laser cutting-speed/pierce-time data anywhere in this schema.
--
-- Today this is masked by an accident, not a real guarantee: Quattro
-- (machine_class='co2_laser', see migration 456) has power_kw=NULL, so
-- bom-items.service.ts's null-power gate skips the sm_lookup_laser_cut query
-- entirely and reports MISSING_MACHINE_DATA — never touching this table.
-- But the moment someone reads Quattro's real oscillator nameplate
-- ("AMADA FANUC AF1000i-C" or "...AF2000i-C LU2.5" — see this session's
-- research) and fills in a real power_kw (1000 or 2500), getLaserParams
-- would find that power close to several REAL FIBER rows (e.g. 1000W,
-- 1500W, 2000W all exist for Carbon Steel) and silently return fiber
-- cutting-speed/pierce-time for a CO2 machine — exactly the "generic Fiber
-- Laser table for Quattro" substitution explicitly forbidden this session.
-- This migration makes that structurally impossible instead of relying on
-- power staying unknown forever.
--
-- Web research this session (AMADA's own Quattro brochure E005-EU02en,
-- amada.eu; AMADA America's "Cutting Know-How for Amada Lasers"; AMADA
-- patent US10,328,528 B2) found NO published AMADA CO2/AF-series cutting-
-- speed-vs-thickness or pierce-time-vs-thickness table meeting this app's
-- sourcing bar (OEM-published, material/thickness-specific, not a fiber
-- table, not a rapid-feed spec). The real numbers exist only inside the
-- machine's own AMNC control condition tables (per the brochure's own
-- description of the control's stored cutting-condition sets) — not in any
-- public document. Consequently NO co2 rows are seeded here. That is the
-- correct, honest state: co2_laser cutting speed/pierce time stays a real,
-- reported gap until someone reads the condition tables off the physical
-- machine or AMADA provides them directly — never filled with a guess.
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE sm_lookup_laser_cut
  ADD COLUMN IF NOT EXISTS laser_technology VARCHAR(10) NOT NULL DEFAULT 'fiber';

ALTER TABLE sm_lookup_laser_cut
  ADD CONSTRAINT sm_lookup_laser_cut_technology_check
  CHECK (laser_technology IN ('fiber', 'co2'));

-- Every existing row is fiber data (see comment above) — the DEFAULT above
-- already makes new rows 'fiber' unless stated otherwise; this UPDATE just
-- makes the backfill explicit/auditable rather than relying on the default
-- silently applying to rows that predate this column.
UPDATE sm_lookup_laser_cut SET laser_technology = 'fiber' WHERE laser_technology IS NULL;

-- Replace the old (material, thickness_mm, laser_power_w) uniqueness with
-- one that includes technology — a future real co2 row at the same
-- material/thickness/power as an existing fiber row must be a distinct row,
-- not a conflict.
DROP INDEX IF EXISTS sm_laser_cut_key;
CREATE UNIQUE INDEX IF NOT EXISTS sm_laser_cut_key
  ON sm_lookup_laser_cut(material, thickness_mm, laser_power_w, laser_technology);

COMMENT ON COLUMN sm_lookup_laser_cut.laser_technology IS
  'fiber (~1.06um) or co2 (10.6um) — cutting speed/pierce time genuinely differ by technology, never cross-matched. All rows seeded before 2026-08-09 are fiber; no co2 data exists yet (none found meeting this app''s sourcing bar as of this migration — see comment above).';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT laser_technology, count(*) FROM sm_lookup_laser_cut GROUP BY laser_technology;
-- Expect: fiber -> existing row count, co2 -> 0 (until real sourced data exists).
