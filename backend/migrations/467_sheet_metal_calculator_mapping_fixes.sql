-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 467: Sheet Metal calculator mapping/config fixes (2026-08-13)
--
-- Closes the concrete, evidence-based gaps found in this session's Sheet Metal
-- calculator/lookup-table audit (process_calculator_mappings + calculator_fields
-- cross-referenced directly against live data — see conversation for the full
-- audit). No new engineering data is fabricated here: every fix either corrects
-- a real mis-mapping or reuses an ALREADY-REAL, already-lookup-driven calculator
-- for a closely related operation on the same machine — the same pattern this
-- table already uses elsewhere (e.g. 5 stamping variants sharing one Stamping
-- calculator, Tapping shared across two routes).
--
-- ── Fix 1: Press Brake route bend operations were costed with the STAMPING
-- formula, not the BENDING formula ──────────────────────────────────────────
-- 'Press Brake' route's Bend / Form / Press Brake Bend operations pointed at
-- calculator e12094c7 ("Sheet Metal - Stamping Manufacturing" — a blanking/
-- shear force formula: Length Of Cut x Thickness x Shear Strength x
-- No Of Impressions / 9810, fields named for coil-fed die stamping). The
-- SEPARATE 'Bending/Floating /Forming' route's "Bend Brake" operation — the
-- literal same physical process on the literal same machine class
-- (press_brake) — correctly uses calculator 102772ff ("Sheet Metal - Bending
-- Manufacturing": Thickness^2 x Bend Length x UTS x Bending Coefficient /
-- Shoulder Width, the real bend-force formula, plus real Tool Loading Time /
-- Time Per Stroke lookups). A bend operation was being priced with a stamping
-- force formula. Re-point to the correct, already-real, already-lookup-driven
-- calculator.
UPDATE process_calculator_mappings
SET calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
WHERE id IN (
  'af53350c-6003-499a-a729-e9f09779004a', -- Press Brake / Bend
  'bce6c6d8-1da2-41b8-b10c-44ea049780d5', -- Press Brake / Form
  '406136c2-3c9e-4921-bab2-fa38d7ef9de2'  -- Press Brake / Press Brake Bend
)
AND calculator_id = 'e12094c7-cdfd-4dde-a153-1f98a5250a72';

-- ── Fix 2: 3 operations had NO calculator at all — reuse the real calculator
-- already serving the same machine_class on the same route ─────────────────
-- "Countersinking (if supported by tooling)" and "Forming (Louvers, Embosses)"
-- (Sheet Metal Fabrication route, machine_class='turret_punch') sat uncosted
-- while their route-mates Turret Punching/Hole Punching/Nibbling — same
-- machine class, same route — already use a5d9b23a ("Sheet Metal - TPP
-- Manufacturing"). "Pure Waterjet Cutting (for soft materials)" (Cutting
-- route, machine_class='waterjet') sat uncosted while Waterjet Cutting/
-- Abrasive Waterjet Cutting on the SAME route already use 37a8bb8c ("Sheet
-- Metal - Waterjet Cutting Manufacturing", real sm_lookup_waterjet_cut data).
UPDATE process_calculator_mappings
SET calculator_id = 'a5d9b23a-5b8c-4d2b-98dd-3fa623458716'
WHERE id IN (
  'fd54ed67-cc77-4c95-8d3e-045a2125ba38', -- Countersinking (if supported by tooling)
  '0ed5b96e-334c-44ac-afe5-9c62b5222892'  -- Forming (Louvers, Embosses)
)
AND calculator_id IS NULL;

UPDATE process_calculator_mappings
SET calculator_id = '37a8bb8c-85fa-4ae0-8bf9-bf7f1b491e72'
WHERE id = '4702f774-93c6-46c4-b09a-f946495f076e' -- Pure Waterjet Cutting (for soft materials)
AND calculator_id IS NULL;

-- ── Fix 3: Roll Forming's MHR/LHR fields carried the known-bad flat
-- 91.6/96.14 placeholder default (the same hardcoded-fallback bug pattern
-- already fixed on other calculators this session/prior sessions) ──────────
-- Every other real calculator's MHR per Hour / LHR per Hour fields are left
-- NULL so the dialog's "Applied Rates" auto-fill (the actually-selected
-- machine/labour rate, real per-currency/location data) takes over instead —
-- see ProcessCostDialog.tsx's own comment on this exact fallback chain. A
-- flat 91.6/96.14 default is silently wrong for every location/currency that
-- isn't whatever this value was originally seeded against.
UPDATE calculator_fields SET default_value = NULL
WHERE id IN (
  '2af05782-d670-47de-b41f-1b9ad68ba3f8', -- Roll Forming / MHR per Hour (was '91.6')
  'eb285d38-2f0b-4072-8a4b-32989b4dff6f'  -- Roll Forming / LHR per Hour (was '96.14')
);

-- ── Fix 4: Inspection's MHR/LHR fields defaulted to a literal 0 ─────────────
-- Worse than the 91.6/96.14 pattern — a real, present machine/labour rate
-- would be silently overridden to $0 machine/labour cost if this default were
-- ever used instead of the Applied Rates auto-fill. Same fix as Roll Forming
-- above: NULL, so the real applied rate is what fills the field.
UPDATE calculator_fields SET default_value = NULL
WHERE id IN (
  '2ee2e9a2-f065-4089-8b1f-06972a0faad9', -- Sheet Metal - Inspection / MHR per Hour (was '0')
  'af9323e2-7fe9-4c4b-96b2-ff8706aa64bd'  -- Sheet Metal - Inspection / LHR per Hour (was '0')
);

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT operation, calculator_id FROM process_calculator_mappings
-- WHERE id IN ('af53350c-6003-499a-a729-e9f09779004a','bce6c6d8-1da2-41b8-b10c-44ea049780d5',
--   '406136c2-3c9e-4921-bab2-fa38d7ef9de2','fd54ed67-cc77-4c95-8d3e-045a2125ba38',
--   '0ed5b96e-334c-44ac-afe5-9c62b5222892','4702f774-93c6-46c4-b09a-f946495f076e');
-- SELECT field_name, default_value FROM calculator_fields
-- WHERE id IN ('2af05782-d670-47de-b41f-1b9ad68ba3f8','eb285d38-2f0b-4072-8a4b-32989b4dff6f',
--   '2ee2e9a2-f065-4089-8b1f-06972a0faad9','af9323e2-7fe9-4c4b-96b2-ff8706aa64bd');
-- Expect all default_value = NULL.
