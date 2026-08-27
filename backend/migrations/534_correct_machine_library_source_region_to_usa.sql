-- ============================================================================
-- Migration: Correct sm_reference_data.source_region from 'World Average'
--            to 'USA' for the 281 machine_library rows (migrations 505-508).
-- Purpose: Migrations 505-508 tagged these rows source_region='World Average'
--          based on the source export's own "sector" field. User confirmed
--          (2026-08-22) the export is USA data -- the export's "digital_factory"
--          field ("USA reference export") is the real region/location
--          indicator this app treats as "Digital Factory" elsewhere (matching
--          the mhr_records.location convention and the app's own
--          "Digital Factory: USA" UI label). "sector": "World Average" is a
--          separate axis (industry-sector benchmark scope), not a region --
--          505-508's header comment conflated the two. This corrects the
--          mistake, it does not relabel real World-Average data as USA.
-- Author: Principal Engineering Team
-- Date: 2026-08-22
-- Version: 1.0.0
-- ============================================================================

UPDATE sm_reference_data
SET source_region = 'USA'
WHERE category = 'machine' AND source_version = '2026-03' AND source_region = 'World Average';

-- Verification (run after applying):
--   SELECT source_region, count(*) FROM sm_reference_data
--   WHERE category = 'machine' AND source_version = '2026-03'
--   GROUP BY source_region;
-- Expect: one row, source_region='USA', count=281.
