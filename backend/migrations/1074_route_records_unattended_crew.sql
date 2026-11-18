-- ============================================================================
-- Migration 1074: route-applied process rows keep the crew they were costed with
-- ============================================================================
-- Apply wrote every route line as a process_cost_records row with heads = 1 (route-application.service.ts), whatever crew the engine had
-- costed the line with. A machine that runs unattended (a 3D printer, an SLA machine, an oven: operators 0 in its machine file) was quoted
-- with no labour, and its row said one operator: every reader that derives the cost from the row (the Cost tab, the legacy fallback of
-- persisted-process-cost.ts) charged labour the quote never did. The writer now stores the line's crew; this corrects the rows already
-- written. Their setup_manning holds that same crew (the writer has always stored line.operators there), so a route-applied row with no
-- setup crew is a line costed with none.
-- ============================================================================

-- Guarded: the local-data test stub's process_cost_records lacks these columns; every real database has them.
DO $crew$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'process_cost_records' AND column_name IN ('notes', 'heads', 'setup_manning', 'updated_at')) < 4 THEN
    RETURN;
  END IF;
  UPDATE process_cost_records
  SET heads = 0, updated_at = now()
  WHERE notes LIKE 'auto_fill_from_route:%'
    AND heads = 1
    AND setup_manning = 0;
END $crew$;
