-- ============================================================================
-- Migration 1058: activate the catalog rows the domain calculator migrations linked
-- ============================================================================
-- ROOT CAUSE
--
-- process_calculator_mappings.is_active means "a calculator is wired": the Process dialog (ProcessCostDialog) picks a
-- line's calculator, and the process catalog shows an operation as costed, from active rows only. The domain calculator
-- migrations (domain-calculators-migration.ts: sand casting, investment casting, heat treatment, forging) set each
-- operation's calculator_id but left is_active false. So on a forging, investment or sand cast line the calculator
-- opened blank, nothing was selected, and changing the operation switched to nothing: the rows the calculators were
-- linked to were invisible. Die casting, machining and plastic were activated by their own migrations (886 to 888, 804).
--
-- This activates every row those migrations linked that names a machine class. From 1058 the builder does the same for
-- the rows it links (ACTIVATES_LINKED_MAPPINGS_FROM). A row with no machine class stays inactive: chk_machine_class_required
-- forbids an active one, and the dialog finds a calculator by machine class, so it could not be picked anyway (investment
-- Cooling and Drying, four heat treatments; the engine prices those itself). Rows with no calculator stay inactive, and
-- Sheet Metal's two linked inactive rows (deactivated duplicates, not written by the builder) are untouched.
--
-- Idempotent.
-- ============================================================================

BEGIN;

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group IN ('Sand Casting', 'Casting Investment', 'Heat Treatment', 'Forging')
  AND calculator_id IS NOT NULL
  AND machine_class IS NOT NULL
  AND NOT is_active;

DO $post$
DECLARE left_inactive INT;
BEGIN
  SELECT count(*) INTO left_inactive FROM public.process_calculator_mappings
  WHERE process_group IN ('Sand Casting', 'Casting Investment', 'Heat Treatment', 'Forging') AND calculator_id IS NOT NULL AND machine_class IS NOT NULL AND NOT is_active;
  IF left_inactive > 0 THEN
    RAISE EXCEPTION 'migration 1058: % linked catalog rows are still inactive', left_inactive;
  END IF;
END
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
