-- ============================================================================
-- Migration 840: remove the two legacy zero-cycle fixture lines, then validate
-- ck_pcr_cycle_time_positive
-- ============================================================================
-- Migration 717 added ck_pcr_cycle_time_positive (cycle_time > 0) NOT VALID
-- because two process_cost_records rows broke it: the "fixture" lines written
-- on 2026-07-12 by the old auto-fill route cnc-5ax, cycle_time 0, process_group
-- "CNC Machining" (a retired group HR Rates does not have). No costing engine
-- writes such a line any more. They are deleted here by id, and only while
-- they are still exactly that (operation fixture, cycle_time 0), so a row that
-- was edited since is kept. With them gone the constraint holds for every row
-- and is validated, as 717 said it would be once they were resolved.
--
-- One transaction: if any other row still breaks the constraint, VALIDATE
-- fails and the delete is rolled back with it.
-- ============================================================================

DELETE FROM public.process_cost_records
WHERE id IN ('6c57a193-a209-4604-84a7-e6c032592572', 'be45866f-3e4c-43e7-998b-22582bc7e14c')
  AND operation = 'fixture'
  AND cycle_time = 0;

ALTER TABLE public.process_cost_records VALIDATE CONSTRAINT ck_pcr_cycle_time_positive;

-- Verify (expect 0 rows, then convalidated = true):
-- SELECT id FROM public.process_cost_records WHERE cycle_time <= 0;
-- SELECT conname, convalidated FROM pg_constraint WHERE conname = 'ck_pcr_cycle_time_positive';
