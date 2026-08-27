-- ============================================================================
-- Migration: Narrow view for the "Material Usage" Lookup Tables bridge
-- Purpose: The Process admin page's "Lookup Tables" dialog was empty for the
--          Sheet Metal group's "Material Usage" route (Gross Usage/Net
--          Usage) -- not because no real data backs it, but because
--          sm-lookup-bridge.config.ts had no entry for this route at all
--          (getSmLookupBridgeEntries returns [] for any unlisted route,
--          same root cause already documented in this file for the earlier
--          PEM Insertion fix). The real dependency: both calculators'
--          "Material Density"/"Shear Strength" fields (field_type=
--          'database_lookup') resolve from raw_materials.
--
--          raw_materials itself is NOT bridged directly -- it's 512 rows x
--          72 columns, a shared master table used by every process family,
--          and every bridge entry's payload is unconditionally rendered as
--          fully row-editable (processes.service.ts's
--          buildLiveSmLookupTablePayload hardcodes isEditable: true with no
--          per-entry override). Exposing the whole table here would (a) be
--          a far heavier payload than this dialog is built for, and (b)
--          let an admin edit unrelated columns (pricing, manufacturer,
--          country costs) from a narrow "Material Usage" screen never meant
--          to manage general material master data. This view exposes only
--          the two real columns these calculators actually read; a plain
--          UPDATE against a view with no INSTEAD OF trigger fails cleanly
--          at the DB layer, so it is effectively read-only through this
--          dialog without needing a code change to the hardcoded
--          isEditable flag.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

CREATE OR REPLACE VIEW sm_material_usage_reference AS
SELECT id, material, material_type, density_kg_m3, shear_strength_mpa
FROM raw_materials
ORDER BY material;

COMMENT ON VIEW sm_material_usage_reference IS 'Read-only narrow view (material/density_kg_m3/shear_strength_mpa) for the Process admin page''s Material Usage Lookup Tables dialog -- the real values Gross Usage/Net Usage''s database_lookup calculator fields resolve from. See sm-lookup-bridge.config.ts.';

GRANT SELECT ON sm_material_usage_reference TO authenticated;
