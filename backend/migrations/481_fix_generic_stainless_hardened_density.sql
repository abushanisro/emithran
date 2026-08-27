-- ============================================================================
-- Migration: Fix missing density on "Generic Stainless Steel Hardened"
-- Purpose: raw_materials row id e3b1622c-e588-48d7-af90-b4d3544b5ead
--          ("Generic Stainless Steel Hardened") had density_kg_m3 = NULL,
--          found while checking this table's per-grade densities during the
--          Sheet Metal reference-data reconciliation. "Hardened" generic
--          stainless steel is conventionally a precipitation-hardened grade
--          (17-4PH being the canonical example) — this table already carries
--          "Generic Stainless Steel, 17-4PH" at density_kg_m3 = 7770, and a
--          verified 7700-7800 kg/m3 range for hardened stainless corroborates
--          that value. NOT set to a generic carbon-steel-style default
--          (e.g. 7850, already used elsewhere in this table for plain
--          carbon steel) — every other stainless row here is distinctly
--          higher (7770-8073), and reusing the carbon-steel figure would
--          blur that real distinction. User-confirmed 2026-08-19.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

UPDATE raw_materials
SET density_kg_m3 = 7770
WHERE id = 'e3b1622c-e588-48d7-af90-b4d3544b5ead'
  AND density_kg_m3 IS NULL;
