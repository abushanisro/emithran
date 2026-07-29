-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 374: Clear "Highly Skilled" labor selections on process_cost_records
-- — that band is never a valid selection for any real manufacturing operation.
--
-- Root cause: per the actual labour-rate seed data (backend/data/lhr-db.csv,
-- imported into lhr_records), the "Highly Skilled" band's own description is
-- explicitly "supervisory/production management/engineering" — it has no
-- hands-on machine-operation duties listed at all (contrast "Skilled":
-- "...laser cutting machine programing...", "Semi-Skilled":
-- "...Machining (turing).../Surface grinding/Boring/.../welding/...").
--
-- process_cost_records rows always represent a specific operation with a real
-- cycle time and machine (Laser Cut, Bend, Hand Deburring, Tapping, CNC
-- Milling, ...) — none of which is a supervisory/management/engineering role.
-- So unlike the labour-ranking fix in ProcessCostDialog.tsx (which only
-- affects what gets auto-picked for NEW selections), there is no ambiguity or
-- judgment call here: a saved row with labor_type = 'Highly Skilled' is
-- unconditionally wrong, full stop, for every operation this table can ever
-- contain — it's the direct, deterministic consequence of the pre-fix
-- "auto-select filteredLHR[0], ignore the operation" bug (see
-- ProcessCostDialog.tsx's rankByOperationMatch).
--
-- Fix: clear (not guess a replacement for) lhr_id/labor_type on every such row.
-- A specific replacement (e.g. "Skilled" vs "Semi-Skilled") is a judgment call
-- best made by re-opening the record — the app's now-fixed labour ranking will
-- correctly suggest the right band from the operation name — rather than a
-- migration silently picking one via fuzzy text matching against financial
-- data. This mirrors the same discipline already applied to machine selection:
-- show an honest "not selected" state, never fabricate a specific answer.
--
-- labor_rate (the numeric $/hr) is deliberately left as-is — recomputing the
-- full cost breakdown requires the app's calculation engine, not raw SQL: the
-- record will show its old rate number next to an honest "not selected" labour
-- identity until it's re-opened and re-saved, exactly like the machine-side
-- "Manual rate — not linked to a machine, but Machine Rate: $9/hr" state
-- already seen and understood earlier in this same cleanup.
--
-- Idempotent: scoped to labor_type ILIKE '%highly skilled%'; once cleared to
-- NULL, re-running is a no-op.
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  cleared_count INTEGER;
  affected_ops  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT COALESCE(operation, '(no operation set)'), '; ')
    INTO cleared_count, affected_ops
  FROM process_cost_records
  WHERE is_active = true
    AND TRIM(labor_type) ILIKE 'highly skilled';

  UPDATE process_cost_records
  SET lhr_id = NULL,
      labor_type = NULL
  WHERE is_active = true
    AND TRIM(labor_type) ILIKE 'highly skilled';

  RAISE NOTICE
    'Migration 374: cleared % row(s) with an invalid "Highly Skilled" labour selection (affected operations: %). Re-open and re-save each in the dialog to pick the correct labour band — the fixed ranking will now suggest it from the operation.',
    cleared_count, COALESCE(affected_ops, '(none)');
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, op_nbr, process_group, process_route, operation, labor_type
-- FROM process_cost_records WHERE is_active = true AND labor_type ILIKE '%highly skilled%';
-- Expected: 0 rows.
