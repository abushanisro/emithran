-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 381: Sheet-metal feature-driven routing (2026-07-30)
--
-- Feature-driven Phase 1: the sheet-metal cost engine (bom-items/costing/cost-engine.ts)
-- currently only ever emits Laser Cutting / Press Brake / Deburring / Tapping —
-- a hardcoded scalar-gated if-cascade, regardless of what the feature recognizer
-- actually finds on the part. This migration adds the reference data needed for
-- three real, geometrically-detectable secondary operations that were previously
-- unroutable: Counterboring, Countersinking, PEM Insertion.
--
-- Reaming and CMM Inspection already have process_calculator_mappings rows
-- (machine_class 'drill_press' / 'cmm' — see migration 368) and are reused
-- unchanged; only the cost engine's routing logic (application code, not schema)
-- needs to start gating on them for sheet metal.
--
-- Follows the same pattern as the existing sm_lookup_* tables (300):
-- shared reference data, public SELECT, no client writes, fallback constants
-- (defined in default-rates.ts) used only when a DB row is absent.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Table: Counterbore cycle time (sec per hit, by counterbore diameter) ──────────
CREATE TABLE IF NOT EXISTS sm_lookup_counterbore (
    id                  SERIAL PRIMARY KEY,
    diameter_mm         NUMERIC NOT NULL,
    cycle_time_sec      NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_counterbore_diameter ON sm_lookup_counterbore(diameter_mm);

-- ── Table: Countersink cycle time (sec per hit, by countersink entry diameter) ────
CREATE TABLE IF NOT EXISTS sm_lookup_countersink (
    id                  SERIAL PRIMARY KEY,
    diameter_mm         NUMERIC NOT NULL,
    cycle_time_sec      NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_countersink_diameter ON sm_lookup_countersink(diameter_mm);

-- ── Table: PEM hardware install match (hole diameter + sheet thickness → part spec) ─
-- Not a geometric detector — PEM hardware is identified by matching an existing
-- through-hole's diameter + sheet thickness against PEM's published install-hole
-- specs. diameter/thickness tolerance banding is applied by the caller (nearest
-- match within +/-0.1mm diameter, +/-0.2mm thickness), not by this table.
CREATE TABLE IF NOT EXISTS sm_lookup_pem_hardware (
    id                  SERIAL PRIMARY KEY,
    hole_diameter_mm    NUMERIC NOT NULL,
    sheet_thickness_mm  NUMERIC NOT NULL,
    pem_part_spec       VARCHAR(50) NOT NULL,   -- e.g. 'PEM S-M4-1'
    insertion_cycle_sec NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_pem_hardware_key ON sm_lookup_pem_hardware(hole_diameter_mm, sheet_thickness_mm);

-- ── RLS: public read, no client writes (same policy as sm_lookup_* in migration 300) ─
ALTER TABLE sm_lookup_counterbore ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_countersink ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_lookup_pem_hardware ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'sm_lookup_counterbore',
        'sm_lookup_countersink',
        'sm_lookup_pem_hardware'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Public read" ON %I', tbl);
        EXECUTE format('CREATE POLICY "Public read" ON %I FOR SELECT USING (true)', tbl);
    END LOOP;
END $$;

COMMENT ON TABLE sm_lookup_counterbore  IS 'Counterbore secondary-op cycle time (sec/hit) by counterbore diameter';
COMMENT ON TABLE sm_lookup_countersink  IS 'Countersink secondary-op cycle time (sec/hit) by countersink entry diameter';
COMMENT ON TABLE sm_lookup_pem_hardware IS 'PEM hardware match: hole diameter + sheet thickness -> PEM part spec + insertion cycle time';

-- Seed a starting set of common sizes; rows can be extended per shop without a code change.
INSERT INTO sm_lookup_counterbore (diameter_mm, cycle_time_sec) VALUES
    (6, 8), (8, 8), (10, 9), (12, 10), (16, 11), (20, 12)
ON CONFLICT (diameter_mm) DO NOTHING;

INSERT INTO sm_lookup_countersink (diameter_mm, cycle_time_sec) VALUES
    (6, 6), (8, 6), (10, 7), (12, 7), (16, 8), (20, 9)
ON CONFLICT (diameter_mm) DO NOTHING;

-- PEM self-clinching standard fastener install-hole specs (PEM Type S, common sizes).
INSERT INTO sm_lookup_pem_hardware (hole_diameter_mm, sheet_thickness_mm, pem_part_spec, insertion_cycle_sec) VALUES
    (4.0, 1.0, 'PEM S-M3-1',  4),
    (4.5, 1.5, 'PEM S-M3-2',  4),
    (5.6, 1.0, 'PEM S-M4-1',  4),
    (6.2, 1.5, 'PEM S-M4-2',  4),
    (7.1, 2.0, 'PEM S-M5-2',  5),
    (8.7, 2.0, 'PEM S-M6-2',  5)
ON CONFLICT (hole_diameter_mm, sheet_thickness_mm) DO NOTHING;

-- ── process_calculator_mappings: new secondary-hole operations ────────────────────
-- Counterboring/Countersinking reuse machine_class 'drill_press' (same class already
-- used for Drilling/Gun Drilling/Boring/Reaming — migration 368); PEM Insertion gets
-- its own class since a PEM press is distinct shop equipment, not a drill press.
INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_name, machine_class, display_order)
VALUES
    ('Machining', 'Drilling', 'Counterboring', 'Counterbore Calculator', 'drill_press', 50),
    ('Machining', 'Drilling', 'Countersinking', 'Countersink Calculator', 'drill_press', 51),
    ('Assembly',  'Hardware Insertion', 'PEM Insertion', 'PEM Insertion Calculator', 'pem_press', 52)
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT * FROM sm_lookup_counterbore ORDER BY diameter_mm;
-- SELECT * FROM sm_lookup_countersink ORDER BY diameter_mm;
-- SELECT * FROM sm_lookup_pem_hardware ORDER BY hole_diameter_mm;
-- SELECT process_group, process_route, operation, machine_class FROM process_calculator_mappings
--   WHERE operation IN ('Counterboring', 'Countersinking', 'PEM Insertion', 'Reaming', 'CMM Inspection');
