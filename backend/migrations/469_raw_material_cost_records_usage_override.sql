-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 469: Persist Net/Gross Usage manual-override state
--
-- RawMaterialDialog's "Justify" calculator panel lets a user override the
-- calculator-computed Gross/Net Usage with an explicit value + reason (never
-- silently, and never modifying the underlying nesting result). Today that
-- distinction is transient frontend state only, reset every time the dialog
-- reopens -- these columns make the "⚠ Manual Override" badge and its reason
-- survive a reload, so an auditor can always see what the system calculated
-- vs. what a human overrode and why.
--
-- Additive, nullable/defaulted -- zero risk to existing rows.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE raw_material_cost_records
  ADD COLUMN IF NOT EXISTS gross_usage_is_overridden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gross_usage_override_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS net_usage_is_overridden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_usage_override_reason TEXT NULL;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'raw_material_cost_records'
--     AND column_name IN ('gross_usage_is_overridden', 'gross_usage_override_reason',
--                          'net_usage_is_overridden', 'net_usage_override_reason');
