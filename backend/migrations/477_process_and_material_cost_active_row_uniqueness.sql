-- ============================================================================
-- Migration: Enforce "one active cost row" invariant at the DB layer
-- Purpose: process_cost_records and raw_material_cost_records are both
--          maintained by a delete/deactivate-then-recreate dance driven from
--          the frontend (Cost Guide's "Apply" flow) and, for process costs,
--          also atomically server-side via apply-route/apply-custom-route
--          (writeProcessLinesAsRecords does DELETE...WHERE is_active=true
--          then INSERT in one request). Neither table has ever had a DB-level
--          constraint backing this "single source of truth" invariant — any
--          client race (a real double-click on Apply, or an Apply landing
--          while a material-grade quick-apply from the sidebar is still in
--          flight) or a partially-failed deactivation step (previously
--          silently swallowed — see the accompanying page.tsx fix) can leave
--          two ACTIVE rows for the same operation/material with nothing
--          rejecting it. Confirmed live: duplicate Direct Process Costs/
--          Direct Material Costs lines after Apply, with no error surfaced —
--          and confirmed again when this migration's first draft failed with
--          a real 23505 duplicate on (bom_item_id=b0eac6f0-..., op_nbr=30).
--          Partial unique indexes make the true invariant enforceable by
--          Postgres itself, not just by application-level best-effort locks.
-- Author: Principal Engineering Team
-- Date: 2026-08-18
-- Version: 1.1.0 (adds pre-cleanup of existing duplicate active rows)
-- ============================================================================

-- Step 1: Clean up pre-existing duplicates before the indexes can be created.
-- For each (bom_item_id, op_nbr) group with more than one active row, keep
-- only the most recently created one active — the others are leftovers from
-- the race this whole migration exists to close off, never a legitimate
-- second operation sharing that op_nbr slot.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY bom_item_id, op_nbr ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM process_cost_records
  WHERE is_active = true
)
UPDATE process_cost_records
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Same cleanup for raw material cost records — this engine costs one
-- material grade per part at a time (see autoAddMaterialCost's own "mark ALL
-- active records inactive" replace-on-change logic in page.tsx), so at most
-- one active row per bom_item_id is the intended invariant.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY bom_item_id ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM raw_material_cost_records
  WHERE is_active = true
)
UPDATE raw_material_cost_records
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: Now safe to enforce the invariant going forward.

-- At most one ACTIVE process cost row per (bom_item_id, op_nbr) — op_nbr
-- identifies a specific step (10, 20, 30...) within one item's routing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_process_cost_records_active_op
  ON process_cost_records (bom_item_id, op_nbr)
  WHERE is_active = true;

-- At most one ACTIVE raw material cost row per bom_item_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_material_cost_records_active_item
  ON raw_material_cost_records (bom_item_id)
  WHERE is_active = true;
