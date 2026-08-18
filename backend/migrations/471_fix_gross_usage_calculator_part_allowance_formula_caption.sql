-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 471: Fix "Part To Part Allowance" documentation-only formula caption
--
-- calculators/058 seeded the wrong formula string for this field's default_value
-- (used purely as the "Why: {formula}" caption -- physics_key always drove the
-- real computed value, so this never affected any actual number, only the
-- displayed explanation). The real formula, verified against
-- sheet-metal-nesting.engine.ts's computePartAllowanceMm():
--
--   shearSafe = Shear Strength if > 0, else 350
--   allowance = 0.0593 * Thickness * sqrt(shearSafe / 10)
--
-- (0.0593 is PART_ALLOWANCE_CONSTANT, back-calculated from a reference spec
-- example -- see that function's own file comment). The migration 058
-- caption omitted this constant entirely and had the wrong trailing factor.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE calculator_fields
SET default_value = '0.0593 * {Thickness} * sqrt(IF({Shear Strength} > 0, {Shear Strength}, 350) / 10)'
WHERE field_name = 'Part To Part Allowance'
  AND calculator_id = (
    SELECT id FROM calculators
    WHERE name = 'Sheet Metal - Gross Material Usage (Nesting)' AND user_id IS NULL
    LIMIT 1
  );

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT field_name, default_value FROM calculator_fields
--   WHERE field_name = 'Part To Part Allowance'
--     AND calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Gross Material Usage (Nesting)' AND user_id IS NULL LIMIT 1);
