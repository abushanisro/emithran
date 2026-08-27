-- ============================================================================
-- Migration: Correct "Hole in Bend Zone" DFM threshold to the real value
-- Purpose: dfm_rules_library's "Hole in Bend Zone" rule (id
--          03a9b014-df3f-4072-8ca0-6f60a5c02d4d) stored recommended_value =
--          2.0 (x thickness) with no citation. A real, sourced reference
--          export (sm_reference_data category='lookup_table',
--          key='InsufficientHoleToBendDistance', migration 488) gives the
--          real value as 1.5x thickness for this exact check. Correcting to
--          keep this table consistent with the same real number now used
--          live in dfm-scoring.service.ts's scoreBend()/
--          scoreSheetMetalHole() (both previously used an uncited two-tier
--          1.0x/2.0x split, now consolidated to this same 1.5x).
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

UPDATE dfm_rules_library
SET recommended_value = 1.5,
    recommendation = 'Keep holes >= 1.5x material thickness from bend line; or move hole after bending (adds operation)'
WHERE id = '03a9b014-df3f-4072-8ca0-6f60a5c02d4d';
