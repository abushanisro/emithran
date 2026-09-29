-- ============================================================================
-- Migration 837: rebrand the vendor name staged by migration 809
-- ============================================================================
-- Migration 809 staged tblMilling from memory/Machining/lookup with one cut
-- type naming the licensed data vendor verbatim (15 rows), after migration
-- 650 had rebranded that value to "Roughing - eMithran Traditional" in
-- machining_reference_data. The generator now writes the rebranded value;
-- this corrects a database where the earlier 809 already ran. Matched with
-- the same case-insensitive pattern the generators use (lib/memory-csv.js).
-- Idempotent: a second run matches nothing.
-- ============================================================================

UPDATE machining_reference_data
SET notes = regexp_replace(notes, 'a\s*priori', 'eMithran', 'gi'),
    value = regexp_replace(value, 'a\s*priori', 'eMithran', 'gi'),
    raw = regexp_replace(raw::text, 'a\s*priori', 'eMithran', 'gi')::jsonb
WHERE raw::text ~* 'a\s*priori' OR notes ~* 'a\s*priori' OR value ~* 'a\s*priori';

-- Verify (expect 0):
-- SELECT count(*) FROM machining_reference_data WHERE raw::text ~* 'a\s*priori';
