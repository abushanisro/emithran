-- Migration: give a manually-configured process cost line its real HR Rates category
-- Description: Adds process_cost_records.category, the machine category a manual
--              Edit Process Cost line is configured against ("3 Roll Bender",
--              "Fiber Laser Cutting Machine"). Declares only. No existing column
--              is changed, no existing row is rewritten, no money value moves.
-- Date: 2026-09-09

-- WHY THIS EXISTS
--
-- Edit Process Cost used to pick a process through a three-level cascade read
-- from process_calculator_mappings: Group -> Process Route -> Operation. That
-- cascade was a second, parallel description of the shop floor, maintained by
-- hand in a catalog table, and it disagreed with the HR Rates table the very
-- same dialog then had to resolve a machine and a rate from. The Route level in
-- particular carried no information the engineer used: it existed only to reach
-- the Operation below it.
--
-- The dialog now selects the same two things HR Rates itself is organised by,
-- and reads both from mhr_records directly:
--
--   Process   = mhr_records.process_group        ("Sheet Metal")
--   Category  = the real machine category         ("3 Roll Bender")
--
-- Category is not a raw column on mhr_records. It is benchmark_source_key up to
-- the first colon when the row matched the reference library, otherwise the row
-- machine_class resolved through the verified-class map or humanised. That is
-- MHRService.getDistinctCategories and the frontend mhrCategoryOf, which already
-- agree with each other and with what the HR Rates page groups its rows by.
--
-- WHY A NEW COLUMN AND NOT THE EXISTING operation COLUMN
--
-- The two vocabularies are close enough to look interchangeable and are not.
-- The catalog calls it "3 Roll Bending"; HR Rates calls it "3 Roll Bender".
-- Writing the second into a column that already holds the first would leave any
-- later grouping, matching or reporting on operation silently split across two
-- spellings of one machine, with nothing on screen to show it had happened.
--
-- WHAT KEEPS WORKING UNCHANGED
--
-- process_route and operation are untouched. Every row written so far keeps its
-- values and keeps displaying them. The engine-generated path (auto-fill from
-- CAD and apply-route, through replace_active_process_cost_records) still writes
-- a real operation for every line it produces, because a generated route genuinely
-- has operations; it simply leaves category NULL, which is honest rather than a
-- back-filled guess. Readers fall back category -> operation -> process_group, so
-- both kinds of row identify themselves correctly.

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS category VARCHAR(200);

COMMENT ON COLUMN process_cost_records.category IS
  'Real HR Rates machine category this manually-configured line is costed against (for example "3 Roll Bender"), resolved the same way MHRService.getDistinctCategories and the frontend mhrCategoryOf resolve it: benchmark_source_key before the first colon, else machine_class through the verified-class map or humanised. NULL on engine-generated lines, which identify themselves through operation instead. Never a substitute for machine_class: category is the human grouping HR Rates is organised by, machine_class is the cost-engine key.';

-- Filtering a BOM item process list by category is the read this column exists
-- for; bom_item_id leads because every such read is already scoped to one item.
CREATE INDEX IF NOT EXISTS idx_process_cost_records_bom_item_category
  ON process_cost_records (bom_item_id, category)
  WHERE category IS NOT NULL;

NOTIFY pgrst, 'reload schema';
