-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 456: Identify "Quattro" as a real AMADA Quattro CO2 laser (2026-08-09)
--
-- Verified via AMADA's own official product documentation (fetched directly
-- from cdn.amada.eu — the primary OEM source, not a summary/aggregator):
--   - Beam generation: "High-frequency discharge excited, high speed
--     axial-flow type" — this is CO2 laser architecture, wavelength 10.6μm.
--     Confirmed NOT a fiber laser (fiber is ~1.06μm) despite being tagged
--     machine_class='fiber_laser' in this row before this migration.
--   - Maximum processing dimensions 1250 x 1250 x 100 mm — matches the
--     shop-reported bed size exactly, confirming this IS a real AMADA
--     Quattro, not a coincidentally-named different machine.
--   - Two real oscillator configurations exist: AF1000i-C (1000W) and
--     AF2000i-C LU2.5 (2500W — NOT 2kW; the brochure's own spec table says
--     2500W for this variant).
--
-- What this migration does NOT do: assign power_kw. Nothing in mhr_records,
-- any nameplate/asset/service record, or user-provided evidence identifies
-- which of the two real oscillator configurations this specific shop's
-- machine actually has — AMADA's product literature describes the whole
-- Quattro line, not this one unit. Picking either 1000 or 2500 here would be
-- exactly the "arbitrarily select 1kW or 2kW" this migration was explicitly
-- told not to do. power_kw stays NULL (it already was) until real evidence
-- (nameplate, purchase order, service record) identifies the real value.
--
-- machine_class moves from the incorrect 'fiber_laser' to the new, real
-- 'co2_laser' class (default-rates.ts's MACHINE_REGISTRY, seed-registry.ts's
-- MACHINE_CLASS_DEFAULTS, laser-cutting-engine.ts's Co2LaserCuttingEngine —
-- added this same session specifically so a real CO2 machine has somewhere
-- correct to go instead of being folded into fiber_laser's cutting-speed
-- assumptions).
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET manufacturer = 'AMADA',
    model = 'Quattro',
    machine_class = 'co2_laser'
WHERE machine_name = 'Quattro'
  AND location = 'India'
  AND machine_class = 'fiber_laser';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, location, machine_name, manufacturer, model, machine_class, power_kw
--   FROM mhr_records WHERE machine_name = 'Quattro';
-- Expect manufacturer='AMADA', model='Quattro', machine_class='co2_laser', power_kw NULL.
