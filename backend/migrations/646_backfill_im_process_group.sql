-- ============================================================================
-- Migration 646: Backfill mhr_records.process_group for Injection Molding
--
-- Migration 633 never set process_group on any of the 127 real Injection
-- Molding machine rows (not in its INSERT column list at all) -- confirmed
-- live on the HR Rates page: "Process Group" column shows "-" for every
-- Reaction Injection Molding / Injection Molding / Compression Molding /
-- Structural Foam Molding row (falls through processGroup || commodityCode
-- || '-' with both null).
--
-- 'Plastic & Rubber' is not invented here -- it's the exact, already-
-- established real process_group/taxonomy name this codebase uses for
-- this domain everywhere else: process_taxonomy/process_calculator_
-- mappings (migration 609) and MACHINE_REGISTRY's own processGroupKeywords
-- for these exact 4 classes (default-rates.constants.ts) already list
-- 'Plastic & Rubber' as a real match keyword.
--
-- Only fills rows currently NULL -- never overwrites a real shop-entered
-- value, same discipline as every prior backfill this session.
-- ============================================================================

UPDATE mhr_records SET process_group = 'Plastic & Rubber'
WHERE process_group IS NULL AND machine_class IN (
  'injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding'
);
