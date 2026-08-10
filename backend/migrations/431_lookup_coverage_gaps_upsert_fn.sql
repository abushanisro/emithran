-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 431: upsert_lookup_coverage_gap() — the write path migration 429
-- created the table for but never shipped.
--
-- lookup_coverage_gaps.dedupe_key is a GENERATED STORED column, so it can't
-- be set directly by an INSERT — but it DOES have a real unique index
-- (uq_lookup_coverage_gaps_dedupe), so ON CONFLICT (dedupe_key) works exactly
-- like any other unique constraint. This function does the increment
-- atomically (occurrence_count = occurrence_count + 1), which a plain
-- PostgREST upsert from the backend's supabase-js client cannot express
-- (it can only overwrite columns with client-supplied values, not
-- reference the existing row's own column in the new value).
--
-- Called once per PhysicsGap from resolvePhysicsQuantity (bom-items.service.ts)
-- — fire-and-forget, wrapped in try/catch there; a failure here is a
-- diagnostics-logging problem, never a reason to fail the actual cost calc.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_lookup_coverage_gap(
  p_gap_type text,
  p_table_name text,
  p_process text,
  p_machine_class text,
  p_missing_inputs jsonb,
  p_suggested_sources text[],
  p_reason text,
  p_required_capability text,
  p_priority text
) RETURNS void AS $$
BEGIN
  INSERT INTO lookup_coverage_gaps (
    gap_type, table_name, process, machine_class, missing_inputs,
    suggested_sources, reason, required_capability, priority
  ) VALUES (
    p_gap_type, p_table_name, p_process, p_machine_class, p_missing_inputs,
    p_suggested_sources, p_reason, p_required_capability, p_priority
  )
  ON CONFLICT (dedupe_key) DO UPDATE SET
    occurrence_count = lookup_coverage_gaps.occurrence_count + 1,
    last_seen = now(),
    -- A gap that recurs after being marked 'wontfix' stays 'wontfix' (a
    -- deliberate triage decision, not something a new occurrence should
    -- silently reopen); 'resolved' does get reopened — recurring after
    -- someone thought it was fixed is exactly the signal worth surfacing.
    status = CASE WHEN lookup_coverage_gaps.status = 'wontfix' THEN lookup_coverage_gaps.status ELSE 'open' END;
END;
$$ LANGUAGE plpgsql;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT upsert_lookup_coverage_gap('missing_lookup', 'sm_lookup_manual_stroke',
--   'Press Brake', 'press_brake', '{"thickness_mm": 2}'::jsonb, NULL, NULL, NULL, 'medium');
-- SELECT * FROM lookup_coverage_gaps ORDER BY occurrence_count DESC;
