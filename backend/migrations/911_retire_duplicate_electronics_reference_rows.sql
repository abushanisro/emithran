-- ============================================================================
-- Migration 911: retire the duplicate electronics reference rows from migration 910
-- ============================================================================
-- Migration 910 staged nine machine speeds (flying probe measurement speed, router cutting
-- speed, AOI inspection speed) into electronics_reference_data. The same numbers already live
-- in mhr_records.specs (migration 797 and its follow-ups), the one representation of machine
-- capability on the platform, so keeping a second copy would let the two drift apart.
--
-- Electronics inputs now read those specs in place. electronics_reference_data stays, empty,
-- for values that come from somewhere other than the staged memory files (partner EMS line
-- data, supplier quotes), each with its own source.
--
-- Only rows whose source_ref points at the PCB machine files are removed. Idempotent.
-- ============================================================================

DELETE FROM public.electronics_reference_data
WHERE source_ref LIKE 'memory/PCBA/Machine/%';
